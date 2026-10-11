import { afterEach, describe, expect, it, vi } from 'vitest';
import { Loki, type LokiAdapter } from '../../src';

// The adapters below are the recipes of tutorials/Persistence Adapters.md, word for word; only their imports
// are replaced by fakes of the same shape.

class HttpAdapter implements LokiAdapter {
  readonly #baseUrl: string;

  constructor(baseUrl: string) {
    this.#baseUrl = baseUrl;
  }

  async loadDatabase(dbname: string): Promise<string | null> {
    const response = await fetch(this.#url(dbname));
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`loading ${dbname}: HTTP ${response.status}`);
    }
    return response.text();
  }

  async saveDatabase(dbname: string, data: string): Promise<void> {
    const response = await fetch(this.#url(dbname), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: data,
    });
    if (!response.ok) {
      throw new Error(`saving ${dbname}: HTTP ${response.status}`);
    }
  }

  async deleteDatabase(dbname: string): Promise<void> {
    const response = await fetch(this.#url(dbname), { method: 'DELETE' });
    if (!response.ok && response.status !== 404) {
      throw new Error(`deleting ${dbname}: HTTP ${response.status}`);
    }
  }

  #url(dbname: string): string {
    return `${this.#baseUrl}/${encodeURIComponent(dbname)}`;
  }
}

class S3Adapter implements LokiAdapter {
  readonly #client: S3Client;
  readonly #bucket: string;

  constructor(client: S3Client, bucket: string) {
    this.#client = client;
    this.#bucket = bucket;
  }

  async loadDatabase(dbname: string): Promise<string | null> {
    try {
      const response = await this.#client.send(
        new GetObjectCommand({ Bucket: this.#bucket, Key: dbname }),
      );
      const text = (await response.Body?.transformToString()) ?? '';
      if (text === '') {
        return null;
      }
      // the lokijs aws-s3-sync-adapter stored the database in base64
      return text.startsWith('{') ? text : Buffer.from(text, 'base64').toString();
    } catch (err) {
      if ((err as Error).name === 'NoSuchKey') {
        return null;
      }
      throw err;
    }
  }

  async saveDatabase(dbname: string, data: string): Promise<void> {
    await this.#client.send(
      new PutObjectCommand({
        Bucket: this.#bucket,
        Key: dbname,
        Body: data,
        ContentType: 'application/json',
      }),
    );
  }

  async deleteDatabase(dbname: string): Promise<void> {
    await this.#client.send(new DeleteObjectCommand({ Bucket: this.#bucket, Key: dbname }));
  }
}

class NativeScriptAdapter implements LokiAdapter {
  async loadDatabase(dbname: string): Promise<string | null> {
    const folder = knownFolders.documents();
    if (!folder.contains(dbname)) {
      return null;
    }
    const text = await folder.getFile(dbname).readText();
    return text === '' ? null : text;
  }

  async saveDatabase(dbname: string, data: string): Promise<void> {
    await knownFolders.documents().getFile(dbname).writeText(data);
  }

  async deleteDatabase(dbname: string): Promise<void> {
    const folder = knownFolders.documents();
    if (folder.contains(dbname)) {
      await folder.getFile(dbname).remove();
    }
  }
}

// Fakes of fetch, @aws-sdk/client-s3 and @nativescript/core, with the shapes the recipes use.

interface S3Input {
  Bucket: string;
  Key: string;
  Body?: string;
  ContentType?: string;
}

class GetObjectCommand {
  readonly input: S3Input;
  constructor(input: S3Input) {
    this.input = input;
  }
}
class PutObjectCommand extends GetObjectCommand {}
class DeleteObjectCommand extends GetObjectCommand {}

class S3Client {
  readonly objects = new Map<string, string>();
  failWith: Error | null = null;

  async send(
    command: GetObjectCommand,
  ): Promise<{ Body?: { transformToString(): Promise<string> } }> {
    if (this.failWith) {
      throw this.failWith;
    }
    const key = `${command.input.Bucket}/${command.input.Key}`;
    if (command instanceof PutObjectCommand) {
      this.objects.set(key, command.input.Body ?? '');
      return {};
    }
    if (command instanceof DeleteObjectCommand) {
      this.objects.delete(key);
      return {};
    }
    const body = this.objects.get(key);
    if (body === undefined) {
      throw Object.assign(new Error('The specified key does not exist.'), { name: 'NoSuchKey' });
    }
    return { Body: { transformToString: async () => body } };
  }
}

const documents = new Map<string, string>();
const knownFolders = {
  documents: () => ({
    contains: (name: string) => documents.has(name),
    getFile: (name: string) => {
      if (!documents.has(name)) {
        documents.set(name, '');
      }
      return {
        readText: async () => documents.get(name) ?? '',
        writeText: async (content: string) => {
          documents.set(name, content);
        },
        remove: async () => {
          documents.delete(name);
        },
      };
    },
  }),
};

function fakeServer(): Map<string, string> {
  const files = new Map<string, string>();
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    if (url.startsWith('https://down.example')) {
      return new Response('unavailable', { status: 503 });
    }
    if (method === 'PUT') {
      files.set(url, String(init.body));
      return new Response(null, { status: 204 });
    }
    const body = files.get(url);
    if (body === undefined) {
      return new Response('not found', { status: 404 });
    }
    if (method === 'DELETE') {
      files.delete(url);
      return new Response(null, { status: 204 });
    }
    return new Response(body, { status: 200 });
  });
  return files;
}

async function roundTrip(makeAdapter: () => LokiAdapter): Promise<void> {
  const fresh = await Loki.open('app.db', { adapter: makeAdapter() });
  expect(fresh.listCollections()).toEqual([]);
  fresh.addCollection('users').insert([{ name: 'odin' }, { name: 'thor' }]);
  await fresh.saveDatabase();

  const reopened = await Loki.open('app.db', { adapter: makeAdapter() });
  expect(reopened.getCollection('users')?.count()).toBe(2);
  await reopened.deleteDatabase();

  const gone = await Loki.open('app.db', { adapter: makeAdapter() });
  expect(gone.listCollections()).toEqual([]);
}

afterEach(() => {
  vi.unstubAllGlobals();
  documents.clear();
});

describe('custom adapter recipes', () => {
  it('HTTP: saves, loads and deletes through fetch', async () => {
    const files = fakeServer();
    await roundTrip(() => new HttpAdapter('https://api.example/db'));
    expect(files.size).toBe(0);
  });

  it('HTTP: rejects with the status when the server fails', async () => {
    fakeServer();
    const db = new Loki('app.db', { adapter: new HttpAdapter('https://down.example/db') });
    await expect(db.loadDatabase()).rejects.toThrow('loading app.db: HTTP 503');
    await expect(db.saveDatabase()).rejects.toThrow('saving app.db: HTTP 503');
  });

  it('S3: saves, loads and deletes through the client', async () => {
    const client = new S3Client();
    await roundTrip(() => new S3Adapter(client, 'bucket'));
    expect(client.objects.size).toBe(0);
  });

  it('S3: reads a database saved in base64 by the lokijs adapter', async () => {
    const client = new S3Client();
    const old = new Loki('app.db');
    old.addCollection('users').insert({ name: 'odin' });
    client.objects.set('bucket/app.db', Buffer.from(old.serialize()).toString('base64'));

    const db = await Loki.open('app.db', { adapter: new S3Adapter(client, 'bucket') });
    expect(db.getCollection('users')?.count()).toBe(1);
  });

  it('S3: rejects on errors other than a missing key', async () => {
    const client = new S3Client();
    client.failWith = Object.assign(new Error('Access Denied'), { name: 'AccessDenied' });
    const db = new Loki('app.db', { adapter: new S3Adapter(client, 'bucket') });
    await expect(db.loadDatabase()).rejects.toThrow('Access Denied');
    await expect(db.saveDatabase()).rejects.toThrow('Access Denied');
  });

  it('NativeScript: saves, loads and deletes in the documents folder', async () => {
    await roundTrip(() => new NativeScriptAdapter());
    expect(documents.size).toBe(0);
  });

  it('NativeScript: treats an empty file as no database', async () => {
    documents.set('app.db', '');
    const db = await Loki.open('app.db', { adapter: new NativeScriptAdapter() });
    expect(db.listCollections()).toEqual([]);
  });
});
