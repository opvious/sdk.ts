# Set cover

+ Vertices $\label{d:vertices} V$
+ Sets $\label{d:sets} S$
+ Coverage $\label{p:coverage} c \in \\\{0,1\\\}^{S \times V}$
+ Usage $\label{v:usage} \alpha \in \\\{0,1\\\}^S$

Minimize sets used: $$\label{o} \min \sum_{s \in S} \alpha_s$$

All vertices must be covered:

$$
  \label{c:allCovered}
  \forall v \in V, \sum_{s \in S} \alpha_s c_{s, v} \geq 1
$$
