import { Accounts } from './auth.js';
const accounts = new Accounts(process.env.PATEX_DATA_DIR || '.patex-data');
if (process.argv[2] !== 'owner-invite') throw new Error('Usage: node dist/node/server/manage.js owner-invite [username]');
const owner = await accounts.owner() || await accounts.create(process.argv[3] || 'samuel', true);
const invite = await accounts.invite(owner.id);
console.log(`${process.env.PATEX_PUBLIC_URL || 'http://patex.sl'}/#invite=${invite}`);
