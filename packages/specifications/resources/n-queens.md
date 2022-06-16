# N queens

First, let $\label{p:size} n \in \mathbb{N}$ be the size of the board.
Given this, we define $\label{d:possiblePositions} N \doteq \\\{1 \ldots n\\\}$
the set of possible positions and $\label{v:decisions} \alpha \in \\\{0,1\\\}^{N \times N}$
our optimization variable. A valid board must satisfy the following constraints:

+ Exactly one queen per row:

  $$\label{c:onePerRow} \forall i \in N, \sum_{j \in N} \alpha_{i,j} = 1$$

+ Exactly one queen per column:

  $$
    \label{c:onePerColumn} \forall j \in N, \sum_{i \in N} \alpha_{i,j} = 1
  $$

+ At most one queen per diagonal:

  $$
    \label{c:onePerDiag1}
    \forall d \in \{2 \ldots 2 n\},
      \sum_{i \in N \mid d - i \in N} \alpha_{i,d-i} \leq 1
  $$

  $$
    \label{c:onePerDiag2}
    \forall d \in \{1-n \ldots n-1\},
      \sum_{i \in N \mid i - d \in N} \alpha_{i,i-d} \leq 1
  $$
