#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),value=k=>{const i=args.indexOf(k);return i<0?undefined:args[i+1];};
const file=path.join(root,'runtime.local.json');
if(fs.existsSync(file))throw Error('已有 runtime.local.json；保留现有文件，请人工检查修改');
const port=Number(value('--port')||53470),account=value('--account');
if(!Number.isInteger(port)||port<1||port>65535)throw Error('端口必须在 1—65535');
if(!account?.trim())throw Error('需要 --account "已登录招聘账号的完整菜单文本"；无需密码或 Cookie');
const runtime={port,expectedAccountLabel:account.trim(),dependencyPackage:path.join(root,'package.json'),stateDirectory:path.join(os.homedir(),'Library/Application Support/boss-framework'),legacyLock:path.join(os.homedir(),'Library/Application Support/boss-automation/state/autogreet-stability.lock')};
fs.writeFileSync(file,JSON.stringify(runtime,null,2)+'\n',{mode:0o600,flag:'wx'});
console.log(JSON.stringify({created:file,platformActions:0}));
