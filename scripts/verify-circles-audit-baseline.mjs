import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const expectedBaseRevisions = [
  // Original Phase 1 snapshot branch.
  '8fa4ed39e15d139d5262843a306dd17fcac048c4',
  // Clean audit branch rebased by application onto current origin/main.
  '946ac7a3f5a61286e15f9d6af901bdedb190644f',
];

const expected = new Map([
  ['contracts/CircleApprovalPolicy.sol', 'bd0f765beb903158bd034ca05f227b7caa4709babfd07989461f145b2db2011e'],
  ['contracts/CircleFactory.sol', '04a643cf26d9b7aa3b476cdb1edeec97aaca3c8c797e984403dd84b4988d2837'],
  ['contracts/CircleVault.sol', 'f3791d44a739a87c8b7de7bd9fcfb9f4815648238c0870a764e74ab56238a564'],
  ['contracts/ICircleApprovalPolicy.sol', 'dad0c33b50dc4a72c2d3daa298f4b920751bf873740521b2a9fbc7ecb059e13e'],
  ['contracts/ICircleFactory.sol', 'bb73efa5522a339767d5f3f4397b60c08bf279896a37fd293757586e536124be'],
  ['contracts/ICircleVault.sol', 'e4eeb30f2c7b1cf98bef4da57f0187247d472dc76d42dc06b8377b473e6e3c97'],
  ['contracts/script/DeployCircleFactory.s.sol', '087e6d12456efaba5e906484277b82a5da3026ef38920bc80acc1d462a772fef'],
  ['contracts/test/Circle.Invariants.t.sol', '63634ad09c826b30d0921595c5dfc437ea3b60b465240daf18aa3a8ce8b0dd5c'],
  ['contracts/test/CircleApprovalPolicy.t.sol', '7e78ff3ee14270c879ee4d25f564a4248ce8aa62a0615786c1588435aca8ff0c'],
  ['contracts/test/CircleFactory.t.sol', '012408970b3191a701cb73cefdd38d9346a1842a47223d4ba9f85aee928f4cde'],
  ['contracts/test/CircleVault.t.sol', 'd371ae02af15f5e84d2e4efa762356e21d6bed1f9ec4280fa2bb5870aea6a89a'],
  ['contracts/test/DeploymentScriptGuards.t.sol', '78e668c0b41fee49da78ea9077421f67766074d85233f4b51f6929afc5480a6c'],
]);

function sha256(relativePath) {
  // Hash canonical LF text so a Windows CRLF checkout cannot create false drift.
  const contents = readFileSync(resolve(root, relativePath), 'utf8').replace(/\r\n/g, '\n');
  return createHash('sha256').update(contents, 'utf8').digest('hex');
}

const failures = [];
let actualHead = '';
try {
  actualHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
} catch (error) {
  failures.push(`unable to read git HEAD: ${error.message}`);
}

if (actualHead) {
  const hasExpectedBase = expectedBaseRevisions.some((baseRevision) => {
    try {
      execFileSync('git', ['merge-base', '--is-ancestor', baseRevision, actualHead], {
        cwd: root,
        stdio: 'ignore',
      });
      return true;
    } catch {
      return false;
    }
  });
  if (!hasExpectedBase) {
    failures.push(`git history mismatch: expected one of ${expectedBaseRevisions.join(', ')} to be an ancestor of ${actualHead}`);
  }
} else {
  failures.push(`git history unavailable: expected one of ${expectedBaseRevisions.join(', ')}`);
}

for (const [relativePath, expectedHash] of expected) {
  const absolutePath = resolve(root, relativePath);
  if (!existsSync(absolutePath)) {
    failures.push(`missing ${relativePath}`);
    continue;
  }
  const actualHash = sha256(relativePath);
  if (actualHash !== expectedHash) {
    failures.push(`hash mismatch ${relativePath}: expected ${expectedHash}, got ${actualHash}`);
  }
}

console.log(`Audit baseline accepted base revisions: ${expectedBaseRevisions.join(', ')}`);
console.log(`Audit baseline HEAD: ${actualHead || '<unavailable>'}`);
console.log(`Audit baseline files checked: ${expected.size}`);

if (failures.length > 0) {
  console.error('AUDIT BASELINE FAIL');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('AUDIT BASELINE PASS');
}
