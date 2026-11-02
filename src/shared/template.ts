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
