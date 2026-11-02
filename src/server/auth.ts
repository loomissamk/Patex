import { randomBytes, randomUUID, scrypt as scryptCallback, createHash, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
export interface Account { id: string; username: string; role: 'owner' | 'member'; createdAt: string; disabled?: boolean; password?: string }
export type PublicAccount = Omit<Account, 'password'>;
interface Credential { accountId: string; expires: number; kind: 'session' | 'invite' | 'api' }
const digest = (token: string) => createHash('sha256').update(token).digest('hex');
const publicAccount = ({ password: _password, ...user }: Account): PublicAccount => user;
const equal = (a: string, b: string) => { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
export class Accounts {
  private root: string;
  constructor(dataRoot: string) { this.root = path.join(dataRoot, '_auth'); }
  private async write(name: string, value: unknown): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const temp = path.join(this.root, `.auth-${randomUUID()}`);
    await writeFile(temp, JSON.stringify(value), { mode: 0o600 });
    await rename(temp, path.join(this.root, name));
  }
  private async read<T>(name: string): Promise<T | null> { return readFile(path.join(this.root, name), 'utf8').then(value => JSON.parse(value) as T, () => null); }
  async list(): Promise<PublicAccount[]> { return (await this.users()).map(publicAccount); }
  private async users(): Promise<Account[]> { const entries = await readdir(this.root).catch(() => []); return (await Promise.all(entries.filter(name => name.startsWith('user-')).map(name => this.read<Account>(name)))).filter((user): user is Account => Boolean(user)); }
  async owner(): Promise<PublicAccount | null> { const owner = (await this.users()).find(user => user.role === 'owner'); return owner ? publicAccount(owner) : null; }
  async create(username: string, owner = false): Promise<PublicAccount> {
    if (typeof username !== 'string' || !/^[A-Za-z0-9_.-]{3,64}$/.test(username)) throw new Error('Use a username of 3–64 letters, numbers, dots, or underscores');
    const users = await this.users();
    if (users.length >= 30) throw new Error('Pilot account limit reached (30)');
    if (users.some(user => user.username.toLowerCase() === username.toLowerCase())) throw new Error('Username already exists');
    if (owner && users.some(user => user.role === 'owner')) throw new Error('Owner already exists');
    const user: Account = { id: randomUUID(), username, role: owner ? 'owner' : 'member', createdAt: new Date().toISOString() };
    await this.write(`user-${user.id}.json`, user);
    return publicAccount(user);
  }
  private async credential(user: PublicAccount, kind: Credential['kind'], lifetime: number): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.write(`token-${digest(token)}.json`, { accountId: user.id, kind, expires: Date.now() + lifetime } satisfies Credential);
    return token;
  }
  async invite(id: string): Promise<string> { const user = await this.user(id); if (!user || user.disabled) throw new Error('Account unavailable'); return this.credential(user, 'invite', 24 * 60 * 60 * 1000); }
  private async user(id: string): Promise<Account | null> { if (!/^[0-9a-f-]{36}$/.test(id)) return null; return this.read<Account>(`user-${id}.json`); }
  async exchangeInvite(token: string): Promise<{ token: string; user: PublicAccount }> {
    const name = `token-${digest(token)}.json`; const credential = await this.read<Credential>(name);
    const user = credential && await this.user(credential.accountId);
    if (!credential || credential.kind !== 'invite' || credential.expires < Date.now() || !user || user.disabled) throw new Error('Invitation is invalid or expired');
    await unlink(path.join(this.root, name));
    return { token: await this.credential(user, 'session', 7 * 24 * 60 * 60 * 1000), user: publicAccount(user) };
  }
  async login(username: string, password: string): Promise<{ token: string; user: PublicAccount }> {
    const user = (await this.users()).find(user => user.username.toLowerCase() === username.toLowerCase());
    const salt = user?.password?.split(':')[0] || '00000000000000000000000000000000';
    const key = (await scrypt(password, salt, 64) as Buffer).toString('hex');
    if (!user?.password || user.disabled || !equal(`${salt}:${key}`, user.password)) throw new Error('Invalid username or password');
    return { token: await this.credential(user, 'session', 7 * 24 * 60 * 60 * 1000), user: publicAccount(user) };
  }
  async resolve(token: string, kind?: Credential['kind']): Promise<PublicAccount | null> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const credential = await this.read<Credential>(`token-${digest(token)}.json`);
    if (!credential || credential.kind === 'invite' || (kind && credential.kind !== kind) || credential.expires < Date.now()) return null;
    const user = await this.user(credential.accountId);
    return user && !user.disabled ? publicAccount(user) : null;
  }
  async revoke(token: string): Promise<void> { await unlink(path.join(this.root, `token-${digest(token)}.json`)).catch(() => {}); }
  async setPassword(id: string, password: string): Promise<void> {
    if (typeof password !== 'string' || password.length < 12 || password.length > 128) throw new Error('Use a password of 12–128 characters');
    const user = await this.user(id); if (!user) throw new Error('Account unavailable');
    const salt = randomBytes(16).toString('hex'); const key = (await scrypt(password, salt, 64) as Buffer).toString('hex');
    await this.write(`user-${id}.json`, { ...user, password: `${salt}:${key}` });
  }
  async apiToken(id: string): Promise<string> { const user = await this.user(id); if (!user || user.disabled) throw new Error('Account unavailable'); return this.credential(user, 'api', 30 * 24 * 60 * 60 * 1000); }
  async disable(id: string, disabled: boolean): Promise<void> { const user = await this.user(id); if (!user || user.role === 'owner') throw new Error('Cannot disable owner'); await this.write(`user-${id}.json`, { ...user, disabled }); }
}
export function sessionCookie(token: string, secure = process.env.PATEX_COOKIE_SECURE === 'true'): string { return `patex_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${token ? 7 * 24 * 60 * 60 : 0}${secure ? '; Secure' : ''}`; }
export function cookieToken(cookie = ''): string | null { return cookie.match(/(?:^|;\s*)patex_session=([^;]*)/)?.[1] ?? null; }
export function matchesMaster(value: string, expected?: string): boolean { return Boolean(expected && equal(value, `Bearer ${expected}`)); }
