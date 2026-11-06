import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { hash } from 'bcryptjs';
import path from 'node:path';
import { openDatabase, persistStore } from '../database/sqlite';
import { emptyStore, isStoredStore, type User } from '../models/store';

async function askHidden(prompt: string): Promise<string> {
  if (!stdin.isTTY) throw new Error('OWNER_PASSWORD must be provided when running without an interactive terminal.');
  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error?: Error) => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\n');
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk: Buffer) => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\u0003') return finish(new Error('Owner setup cancelled.'));
        if (character === '\r' || character === '\n') return finish();
        if (character === '\u007f' || character === '\b') {
          value = value.slice(0, -1);
        } else if (character >= ' ') {
          value += character;
        }
      }
    };
    stdin.on('data', onData);
  });
}

async function main() {
  const dataDirectory = path.resolve(process.env.STOCKROOM_DATA_DIR ?? 'data');
  const legacyFile = path.join(dataDirectory, 'store.json');
  const databasePath = path.resolve(process.env.STOCKROOM_DATABASE_PATH ?? path.join(dataDirectory, 'stockroom.sqlite'));
  const { database, store, migrated } = openDatabase(databasePath, legacyFile, emptyStore, isStoredStore);
  try {
    if (migrated) console.log(`Migrated existing store records from ${legacyFile}.`);
    if (store.users.some((user) => user.role === 'admin')) {
      throw new Error('An Owner account already exists. Owner setup is one-time and cannot create another Owner.');
    }

    const prompt = createInterface({ input: stdin, output: stdout });
    const name = process.env.OWNER_NAME?.trim() || (await prompt.question('Owner name: ')).trim();
    const email = (process.env.OWNER_EMAIL?.trim() || (await prompt.question('Owner email: ')).trim()).toLowerCase();
    prompt.close();
    const password = process.env.OWNER_PASSWORD ?? await askHidden('Owner password (12+ characters): ');
    if (!name || name.length > 160) throw new Error('Owner name is required and must be 160 characters or fewer.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error('Enter a valid Owner email address.');
    if (password.length < 12 || password.length > 200) throw new Error('Owner password must be between 12 and 200 characters.');
    if (store.users.some((user) => user.email.toLowerCase() === email)) throw new Error('This email address is already in use.');

    const owner: User = {
      id: `usr-${randomBytes(12).toString('hex')}`,
      name,
      email,
      passwordHash: await hash(password, 12),
      role: 'admin',
      active: true,
      createdAt: new Date().toISOString(),
    };
    store.users.push(owner);
    store.activity.unshift({
      id: `act-${randomBytes(12).toString('hex')}`,
      userId: owner.id,
      userName: owner.name,
      action: 'completed secure Owner account setup',
      createdAt: owner.createdAt,
    });
    persistStore(database, store);
    console.log(`Owner account created for ${owner.email}. Sign in using the Owner workspace.`);
  } finally {
    database.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Owner setup failed.');
  process.exitCode = 1;
});
