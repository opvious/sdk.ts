# N queens

First, let $\S^p_{size}: n \in \mathbb{N}$ be the size of the board.
Given this, we define $\S^a: N \doteq \{1 \ldots n\}$
the set of possible positions and
$\S^v_{decisions}: \alpha \in \{0,1\}^{N \times N}$ our optimization variable.
A valid board must satisfy the following constraints:

+ Exactly one queen per row:

  $$\S^c_{onePerRow}: \forall i \in N, \sum_{j \in N} \alpha_{i,j} = 1$$

+ Exactly one queen per column:

  $$
    \S^c_{onePerColumn}: \forall j \in N, \sum_{i \in N} \alpha_{i,j} = 1
  $$

+ At most one queen per diagonal:

  $$
    \S^c_{onePerDiag1}:
    \forall d \in \{2 \ldots 2 n\},
      \sum_{i \in N \mid d - i \in N} \alpha_{i,d-i} \leq 1
  $$

  $$
    \S^c_{onePerDiag2}:
    \forall d \in \{1-n \ldots n-1\},
      \sum_{i \in N \mid i - d \in N} \alpha_{i,i-d} \leq 1
  $$
