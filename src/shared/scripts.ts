import type { ProjectScripts, ScriptLanguage } from './types.js';

export const scriptFiles: Record<ScriptLanguage, string> = {
  javascript: 'analysis.js', python: 'analysis.py', r: 'analysis.R',
};

export const defaultScripts: ProjectScripts = {
  javascript: `const fs = require('node:fs');
const values = [2, 4, 6, 8];
const mean = values.reduce((a, b) => a + b, 0) / values.length;
console.log('JavaScript mean:', mean);
fs.writeFileSync('js-result.tex', String(mean));
// In main.tex: \\input{assets/js-result.tex}
`,
  python: `from pathlib import Path
from statistics import mean

values = [2, 4, 6, 8]
result = mean(values)
print("Python mean:", result)
Path("python-result.tex").write_text(str(result))
# In main.tex: \\input{assets/python-result.tex}
`,
  r: `values <- c(2, 4, 6, 8)
cat("R mean:", mean(values), "\\n")
png("r-plot.png", width=800, height=500)
plot(values, type="b", main="Example R plot", xlab="Observation", ylab="Value")
dev.off()
# In main.tex (with \\usepackage{graphicx}): \\includegraphics{assets/r-plot.png}
`,
};
