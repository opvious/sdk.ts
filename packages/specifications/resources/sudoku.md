# Sudoku model

We start by defining the sets of possible values
$\label{a:values} N \doteq \\\{1 \ldots 9\\\}$ and possible
positions $\label{a:positions} P \doteq \\\{0 \ldots 8\\\}$. With
these two, we can define the variable we will optimize over:
$\label{v:decisions} \alpha \in \\\{0,1\\\}^{P \times P \times N}$.

The first constraint uses input hints $\label{p:hints} h \in \{0,1\}^{P \times P \times N}$, enforcing that our choice always matches the hint:

$$
  \label{c:hintsObserved}
  \forall v \in N, i,j \in P, \alpha_{i,j,v} \geq h_{i,j,v}
$$

Then there are three types of unicity constraints, all enforcing that there must
be one of each value.

+ First, per row:

  $$
    \label{c:onePerRow}
    \forall v \in N, i \in P,
      \sum_{j \in P} \alpha_{i,j,v} = 1
  $$

+ Then, per column:

  $$
    \label{c:onePerColumn}
    \forall v \in N, j \in P,
      \sum_{i \in P} \alpha_{i,j,v} = 1
  $$

+ Finally, per box:

  $$
    \label{c:onePerBox}
    \forall v \in N, k \in P,
    \sum_{i,j \in P}
      \alpha_{
        3 \left\lfloor \frac{k}{3} \right\rfloor
          + \left\lfloor \frac{i}{3} \right\rfloor,
        3 (k \mod 3) + (j \mod 3),
        v
      }
    = 1
  $$
