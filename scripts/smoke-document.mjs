import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { log } from 'node:console';
import { compileLatex } from '../dist/node/compiler/compile.js';
import { renderLiterate } from '../dist/node/compiler/render.js';
import { defaultQmd, defaultRmd } from '../dist/node/shared/template.js';

const bibliography = '@book{knuth1984, title={The TeXbook}, author={Knuth, Donald E.}, year={1984}, publisher={Addison-Wesley}}';
const check = (label, result) => {
  assert.equal(result.ok, true, `${label}: ${result.log.slice(-1800)}`);
  const pdf = Buffer.from(result.pdfBase64, 'base64');
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  log(`${label}: PDF ${pdf.length} bytes`);
};

const rmd = `${defaultRmd}\nThis source cites [@knuth1984].\n\n\`\`\`{r, echo=FALSE, fig.width=4, fig.height=3}\nplot(c(2, 4, 6, 8), type="b")\n\`\`\`\n`;
check('Rmd code, inline value, figure, citation', await renderLiterate(rmd, 'rmd', [], bibliography));
check('Qmd code and inline value', await renderLiterate(defaultQmd, 'qmd'));
const tex = String.raw`\documentclass{article}
\begin{document}
Knuth wrote about TeX \cite{knuth1984}.
\bibliographystyle{plain}
\bibliography{references}
\end{document}`;
check('native TeX with BibTeX', await compileLatex(tex, [], bibliography));
