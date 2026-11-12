import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { get, type IncomingMessage } from 'node:http';
import { type AddressInfo } from 'node:net';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { APP_CONFIG, loadConfig } from '../src/config/app-config';
import type { VehiclePageDto } from '../src/vehicles/vehicle.dto';

interface SseEvent {
  type: string;
  id?: string;
  data: string;
}

/**
 * Opens the live stream with real HTTP (supertest waits for a response to end, and
 * this one never does), reads events until `ready`, then hangs up.
 */
function readUntilReady(port: number, headers: Record<string, string> = {}, path = '/api/events'): Promise<SseEvent[]> {
  return new Promise((resolve, reject) => {
    const req = get({ port, path, headers: { Accept: 'text/event-stream', ...headers } }, (res: IncomingMessage) => {
      let buffer = '';
      const events: SseEvent[] = [];
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        buffer += chunk;
        let end: number;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const event: SseEvent = { type: 'message', data: '' };
          for (const line of block.split('\n')) {
            const [field, ...rest] = line.split(': ');
            const value = rest.join(': ');
            if (field === 'event') event.type = value;
            else if (field === 'id') event.id = value;
            else if (field === 'data') event.data += value;
          }
          if (block.trim()) events.push(event);
          if (event.type === 'ready') {
            req.destroy();
            resolve(events);
          }
        }
      });
    });
    req.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'ECONNRESET') reject(error);
    });
    req.setTimeout(5000, () => reject(new Error('No ready event within 5s')));
  });
}

describe('Live events (e2e)', () => {
  let app: INestApplication;
  let port: number;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue({ ...loadConfig(), dbPath: ':memory:', simulateBidding: false, routingUrl: null })
      .compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.listen(0);
    port = (app.getHttpServer().address() as AddressInfo).port;
  });

  afterEach(async () => {
    await app.close();
  });

  async function bidOnFirstLot(): Promise<string> {
    const { body } = await request(app.getHttpServer()).get('/api/vehicles').expect(200);
    const lot = (body as VehiclePageDto).items[0];
    await request(app.getHttpServer())
      .post(`/api/vehicles/${lot.id}/bids`)
      .set('X-Bidder-Id', 'live-test-buyer')
      .send({ amount: lot.auction.minNextBid })
      .expect(201);
    return lot.id;
  }

  it('greets a new connection with the current position', async () => {
    const events = await readUntilReady(port);
    expect(events.map((event) => event.type)).toEqual(['ready']);
    expect(events[0].id).toMatch(/^[a-f0-9]+:0$/);
  });

  it('replays what a reconnecting client missed (Last-Event-ID), then says it is caught up', async () => {
    const [ready] = await readUntilReady(port);
    const vehicleId = await bidOnFirstLot();

    const events = await readUntilReady(port, { 'Last-Event-ID': ready.id! });
    expect(events.map((event) => event.type)).toEqual(['auction.updated', 'ready']);
    expect(JSON.parse(events[0].data)).toMatchObject({ vehicleId, reason: 'bid' });
    expect(events[1].id).toBe(events[0].id);
  });

  it('accepts the position as ?since= for a brand-new stream (another tab taking over)', async () => {
    const [ready] = await readUntilReady(port);
    await bidOnFirstLot();

    const events = await readUntilReady(port, {}, `/api/events?since=${encodeURIComponent(ready.id!)}`);
    expect(events.map((event) => event.type)).toEqual(['auction.updated', 'ready']);
  });

  it('tells a client to resync when it can no longer replay (e.g. the server restarted)', async () => {
    const events = await readUntilReady(port, { 'Last-Event-ID': 'deadbeef:42' });
    expect(events.map((event) => event.type)).toEqual(['resync', 'ready']);
  });
});
