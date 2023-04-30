# Set cover

+ Vertices $$\S^d_{vertices} : V$$
+ Sets $$\S^d_{sets} : S$$
+ Coverage $$\S^p_{coverage} : c \in \{0,1\}^{S \times V}$$
+ Usage $$\S^v_{usage} : \alpha \in \{0,1\}^S$$

Minimize sets used: $$\S^o_{setsUsed} : \min \sum_{s \in S} \alpha_s$$

All vertices must be covered: $$\S^c_{allCovered} : \forall v \in V, \sum_{s
\in S} \alpha_s c_{s, v} \geq 1$$
