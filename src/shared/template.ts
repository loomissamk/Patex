export const defaultLatex = String.raw`\documentclass[11pt]{article}
\usepackage[margin=1in]{geometry}
\usepackage{amsmath,amssymb}
\title{My Patex Document}
\author{SL Labs}
\date{\today}
\begin{document}
\maketitle
\section{Welcome}
Edit the source on the left and press \textbf{Compile} to preview the PDF.

\begin{equation}
  \int_0^1 x^2\,dx = \frac{1}{3}
\end{equation}
\end{document}
`;

export const defaultRmd = String.raw`---
title: "My Patex Document"
author: "SL Labs"
output: pdf_document
---

# Results

Write your explanation and LaTeX mathematics in this one document. For example,
$\bar{x}=\frac{1}{n}\sum_{i=1}^{n}x_i$.

` + "```" + String.raw`{r}
values <- c(2, 4, 6, 8)
mean(values)
` + "```" + String.raw`

The computed mean is ` + "`r mean(values)`" + String.raw`.
`;

export const defaultQmd = String.raw`---
title: "My Patex Document"
author: "SL Labs"
format:
  pdf:
    pdf-engine: pdflatex
---

# Results

Write mathematics such as $\bar{x}=\frac{1}{n}\sum_{i=1}^{n}x_i$ beside the analysis.

` + "```" + String.raw`{r}
values <- c(2, 4, 6, 8)
mean(values)
` + "```" + String.raw`

The computed mean is ` + "`{r} mean(values)`" + String.raw`.
`;
