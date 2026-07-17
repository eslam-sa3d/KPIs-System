import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { env } from './env';

/** Thin Redis facade — consumers depend on this interface, not ioredis. */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client = new Redis(env.REDIS_URL);

  get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.client.set(key, value, 'EX', ttlSeconds);
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  ping(): Promise<string> {
    return this.client.ping();
  }

  async onModuleDestroy() {
    await this.client.quit();
  }
}
