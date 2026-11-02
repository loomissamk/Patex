export const publishingTemplates = {
  article: { name: 'Standard article', source: String.raw`\documentclass[11pt]{article}
\usepackage[margin=1in]{geometry}
\usepackage{amsmath,amssymb,graphicx}
\title{Research title}
\author{Author}
\begin{document}
\maketitle
\begin{abstract}State the question, method, and finding.\end{abstract}
\section{Introduction}
Write here.
\end{document}
` },
  ams: { name: 'AMS mathematics article', source: String.raw`\documentclass{amsart}
\usepackage{amssymb,graphicx}
\newtheorem{theorem}{Theorem}[section]
\title{Mathematical article}
\author{Author}
\begin{document}
\begin{abstract}State the main result.\end{abstract}
\maketitle
\section{Main result}
\begin{theorem}\label{thm:main}State the theorem.\end{theorem}
\begin{proof}Write the proof.\end{proof}
\end{document}
` },
  ieee: { name: 'IEEE conference article', source: String.raw`\documentclass[conference]{IEEEtran}
\usepackage{amsmath,amssymb,graphicx}
\title{Conference paper title}
\author{\IEEEauthorblockN{Author}\IEEEauthorblockA{Institution}}
\begin{document}
\maketitle
\begin{abstract}State the problem, method, and results.\end{abstract}
\section{Introduction}
Write here. Check the target venue's submission instructions before publishing.
\end{document}
` },
};
