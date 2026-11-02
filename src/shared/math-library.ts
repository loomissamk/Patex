export interface MathExpression { id: string; name: string; category: string; latex: string; template: string; note: string; aliases: string[] }
const expression = (id: string, name: string, category: string, latex: string, template: string, note: string, aliases: string[] = []): MathExpression => ({ id, name, category, latex, template, note, aliases });
export const mathExpressions: MathExpression[] = [
  expression('frac', 'Fraction', 'Basics', String.raw`\frac{a}{b}`, String.raw`\frac{\${1:a}}{\${2:b}}`, 'Use braces to group the entire numerator and denominator.', ['fraction']),
  expression('sqrt', 'Square root', 'Basics', String.raw`\sqrt{x}`, String.raw`\sqrt{\${1:x}}`, 'For an nth root, use \\sqrt[n]{x}.', ['root']),
  expression('power', 'Subscript and superscript', 'Basics', String.raw`x_i^{n}`, String.raw`\${1:x}_{\${2:i}}^{\${3:n}}`, 'Group multiple characters in braces.', ['index']),
  expression('norm', 'Vector norm', 'Linear algebra', String.raw`\lVert x\rVert_2`, String.raw`\lVert \${1:x}\rVert_{\${2:2}}`, 'Use lVert/rVert for a norm, not a single absolute-value bar.'),
  expression('inner', 'Inner product', 'Linear algebra', String.raw`\langle x,y\rangle`, String.raw`\langle \${1:x},\${2:y}\rangle`, 'Angle brackets denote an inner product.'),
  expression('matrix', '2 by 2 matrix', 'Linear algebra', String.raw`\begin{pmatrix}a&b\\c&d\end{pmatrix}`, String.raw`\begin{pmatrix}\${1:a} & \${2:b} \\ \${3:c} & \${4:d}\end{pmatrix}`, 'Separate columns with & and rows with \\\\.', ['pmatrix']),
  expression('bmatrix', 'Bracket matrix', 'Linear algebra', String.raw`\begin{bmatrix}1&0\\0&1\end{bmatrix}`, String.raw`\begin{bmatrix}\${1:1} & \${2:0} \\ \${3:0} & \${4:1}\end{bmatrix}`, 'Use bmatrix for square brackets.'),
  expression('vector', 'Column vector', 'Linear algebra', String.raw`\begin{pmatrix}x_1\\x_2\end{pmatrix}`, String.raw`\begin{pmatrix}\${1:x_1} \\ \${2:x_2}\end{pmatrix}`, 'A column vector is a one-column matrix.'),
  expression('inverse', 'Matrix inverse and transpose', 'Linear algebra', String.raw`(A^{\mathsf T}A)^{-1}A^{\mathsf T}`, String.raw`(\${1:A}^{\mathsf T}\${1:A})^{-1}\${1:A}^{\mathsf T}`, 'The inverse exists only when the matrix being inverted is nonsingular.'),
  expression('eigen', 'Eigenvalue equation', 'Linear algebra', String.raw`Av=\lambda v`, String.raw`\${1:A}\${2:v}=\${3:\lambda}\${2:v}`, 'An eigenvector v must be nonzero.'),
  expression('det', 'Determinant', 'Linear algebra', String.raw`\det(A-\lambda I)=0`, String.raw`\det(\${1:A}-\${2:\lambda}I)=0`, 'This characteristic equation determines eigenvalues.'),
  expression('sum', 'Summation', 'Calculus', String.raw`\sum_{i=1}^{n}x_i`, String.raw`\sum_{\${1:i}=\${2:1}}^{\${3:n}}\${4:x_i}`, 'Use display math for limits above and below the summation symbol.'),
  expression('prod', 'Product', 'Calculus', String.raw`\prod_{i=1}^{n}x_i`, String.raw`\prod_{\${1:i}=\${2:1}}^{\${3:n}}\${4:x_i}`, 'The product operator multiplies the indexed terms.'),
  expression('int', 'Definite integral', 'Calculus', String.raw`\int_a^b f(x)\,dx`, String.raw`\int_{\${1:a}}^{\${2:b}}\${3:f(x)}\,d\${4:x}`, 'Use \\, for a small space before the differential.', ['integral']),
  expression('doubleint', 'Double integral', 'Calculus', String.raw`\iint_D f(x,y)\,dx\,dy`, String.raw`\iint_{\${1:D}}\${2:f(x,y)}\,dx\,dy`, 'Define the region and the order of integration.'),
  expression('limit', 'Limit', 'Calculus', String.raw`\lim_{x\to a}f(x)`, String.raw`\lim_{\${1:x}\to\${2:a}}\${3:f(x)}`, 'Use \\to for the limiting relation.', ['lim']),
  expression('derivative', 'Derivative', 'Calculus', String.raw`\frac{df}{dx}`, String.raw`\frac{d\${1:f}}{d\${2:x}}`, 'For a partial derivative, replace d with \\partial.'),
  expression('partial', 'Partial derivative', 'Calculus', String.raw`\frac{\partial f}{\partial x}`, String.raw`\frac{\partial \${1:f}}{\partial \${2:x}}`, 'State which other variables are held fixed.'),
  expression('cases', 'Piecewise definition', 'Basics', String.raw`f(x)=\begin{cases}x^2&x\ge0\\0&x<0\end{cases}`, String.raw`\${1:f(x)}=\begin{cases}\${2:x^2} & \${3:x\ge0} \\ \${4:0} & \${5:x<0}\end{cases}`, 'Separate the expression and its condition with &.'),
  expression('prob', 'Conditional probability', 'Probability', String.raw`P(A\mid B)=\frac{P(A\cap B)}{P(B)}`, String.raw`P(\${1:A}\mid\${2:B})=\frac{P(\${1:A}\cap\${2:B})}{P(\${2:B})}`, 'The condition requires P(B)>0.'),
  expression('bayes', 'Bayes theorem', 'Probability', String.raw`P(A\mid B)=\frac{P(B\mid A)P(A)}{P(B)}`, String.raw`P(\${1:A}\mid\${2:B})=\frac{P(\${2:B}\mid\${1:A})P(\${1:A})}{P(\${2:B})}`, 'Use the denominator only when its probability is positive.'),
  expression('expectation', 'Expected value', 'Probability', String.raw`E[X]=\int_{-\infty}^{\infty}x f_X(x)\,dx`, String.raw`E[\${1:X}]=\int_{-\infty}^{\infty}x f_{\${1:X}}(x)\,dx`, 'For a discrete variable use a sum over its support.'),
  expression('variance', 'Variance identity', 'Probability', String.raw`\operatorname{Var}(X)=E[X^2]-(E[X])^2`, String.raw`\operatorname{Var}(\${1:X})=E[\${1:X}^2]-(E[\${1:X}])^2`, 'Requires a finite second moment.'),
  expression('normal', 'Normal density', 'Probability', String.raw`f(x)=\frac{1}{\sigma\sqrt{2\pi}}e^{-(x-\mu)^2/(2\sigma^2)}`, String.raw`f(x)=\frac{1}{\${1:\sigma}\sqrt{2\pi}}e^{-(x-\${2:\mu})^2/(2\${1:\sigma}^2)}`, 'The scale parameter sigma must be positive.'),
  expression('binomial', 'Binomial probability', 'Probability', String.raw`P(X=k)=\binom{n}{k}p^k(1-p)^{n-k}`, String.raw`P(X=\${1:k})=\binom{\${2:n}}{\${1:k}}\${3:p}^{\${1:k}}(1-\${3:p})^{\${2:n}-\${1:k}}`, 'Assumes n independent Bernoulli trials with common p.'),
  expression('mean', 'Sample mean', 'Statistics', String.raw`\bar{x}=\frac{1}{n}\sum_{i=1}^{n}x_i`, String.raw`\bar{\${1:x}}=\frac{1}{\${2:n}}\sum_{i=1}^{\${2:n}}\${1:x}_i`, 'Use a sample mean to estimate a population mean.'),
  expression('samplevariance', 'Sample variance', 'Statistics', String.raw`s^2=\frac{1}{n-1}\sum_{i=1}^{n}(x_i-\bar{x})^2`, String.raw`s^2=\frac{1}{\${1:n}-1}\sum_{i=1}^{\${1:n}}(x_i-\bar{x})^2`, 'The n−1 denominator is the usual unbiased sample variance.'),
  expression('ci', 'Mean confidence interval', 'Statistics', String.raw`\bar{x}\pm t_{1-\alpha/2,n-1}\frac{s}{\sqrt n}`, String.raw`\bar{x}\pm t_{1-\${1:\alpha}/2,\${2:n}-1}\frac{\${3:s}}{\sqrt{\${2:n}}}`, 'For independent normal observations with unknown variance; check assumptions for other settings.'),
  expression('likelihood', 'Likelihood', 'Statistics', String.raw`L(\theta;x)=\prod_{i=1}^{n}f(x_i\mid\theta)`, String.raw`L(\${1:\theta};x)=\prod_{i=1}^{n}f(x_i\mid\${1:\theta})`, 'This product form assumes independent observations.'),
  expression('regression', 'Linear regression', 'Statistics', String.raw`y_i=\beta_0+\beta_1 x_i+\varepsilon_i`, String.raw`y_i=\${1:\beta_0}+\${2:\beta_1}x_i+\${3:\varepsilon_i}`, 'State the assumptions on the error terms separately.'),
  expression('hypothesis', 'Null and alternative', 'Statistics', String.raw`H_0:\mu=\mu_0\qquad H_1:\mu\ne\mu_0`, String.raw`H_0:\${1:\mu}=\${2:\mu_0}\qquad H_1:\${1:\mu}\ne\${2:\mu_0}`, 'Choose a one-sided or two-sided alternative before examining the result.'),
  expression('align', 'Aligned calculation', 'Basics', String.raw`\begin{aligned}a&=b+c\\&=d\end{aligned}`, String.raw`\begin{aligned}\${1:a}&=\${2:b+c} \\ &=\${3:d}\end{aligned}`, 'Place & before the alignment point; put aligned inside display math.'),
];
// String.raw preserves the backslash used to escape ${ in template literals;
// remove that escape so CodeMirror can interpret editable snippet fields.
for (const item of mathExpressions) item.template = item.template.replace(/\\\$\{/g, '${');
export const mathHowTo = [
  ['Inline math', 'Write $x^2$ inside a sentence.'],
  ['Display math', 'Use $$ ... $$ in Rmd/Qmd, or \\[ ... \\] in TeX.'],
  ['Numbered equations', 'Use \\begin{equation} ... \\label{eq:name} ... \\end{equation}, then \\eqref{eq:name}.'],
  ['Symbols', '\\alpha, \\beta, \\gamma, \\theta, \\lambda, \\mu, \\sigma, \\infty, \\le, \\ge, \\ne, \\in, \\subseteq, \\mathbb{R}.'],
  ['Grouping', 'x^{n+1} groups the full exponent. Use \\{ and \\} for visible braces.'],
  ['Citations', 'Use \\cite{key} in TeX and [@key] in Rmd/Qmd. Project bibliography keys complete locally.'],
  ['Local completion', 'Type a command such as \\frac or \\int. Press Ctrl+Space to open suggestions, then Tab to move through editable fields.'],
];
