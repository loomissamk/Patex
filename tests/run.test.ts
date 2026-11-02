import { runCode } from '../src/compiler/run.js';
import { defaultScripts } from '../src/shared/scripts.js';
import { artifactName } from '../src/shared/artifacts.js';

describe('project code runner', () => {
  test('JavaScript produces console output and a TeX artifact', async () => {
    const result = await runCode('javascript', defaultScripts.javascript);
    expect(result.ok).toBe(true);
    expect(result.stdout).toContain('JavaScript mean: 5');
    expect(result.artifacts.find(file => file.name === 'js-result.tex')?.base64).toBe(Buffer.from('5').toString('base64'));
  });
  test('Python produces console output and a TeX artifact', async () => {
    const result = await runCode('python', defaultScripts.python);
    expect(result.ok).toBe(true);
    expect(result.stdout).toContain('Python mean: 5');
    expect(result.artifacts.find(file => file.name === 'python-result.tex')?.base64).toBe(Buffer.from('5').toString('base64'));
  });
  test('invalid source and artifact paths are rejected', async () => {
    expect((await runCode('javascript', 'x'.repeat(110_000))).ok).toBe(false);
    expect(artifactName.test('../escape.tex')).toBe(false);
    const result = await runCode('javascript', "require('node:fs').writeFileSync('bad.exe', 'bad'); console.log('done')");
    expect(result.artifacts).toHaveLength(0);
  });
});
