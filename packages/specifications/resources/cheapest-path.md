# Cheapest path

Shortest path-ish formulation.

Input variables and parameters:

+ All intersections: $\label{d:intersections} I$
+ Distances: $\label{p:distances} d \in \mathbb{R}_+^{I \times I}$
+ Distance cutoff: $\label{p:distanceCutoff} d^{max} \in \mathbb{R}_+$
+ Start flows: $\label{p:startFlow} a^{start} \in \mathbb{R}_+^I$
+ End flows: $\label{p:endFlow} a^{end} \in \mathbb{R}_+^I$
+ Finite distances: $\label{a:finiteDistances} D \doteq \\\{ i,j \in I \mid d_{i,j} < d^{max} \\\}$
+ Neighbors: $\label{a:neighbors} \forall i \in I, N_i \doteq \\\{ j \in I \mid (i, j) \in D \\\}$

Decision variables:

+ In flows: $\label{v:inFlow} \alpha^{in} \in \mathbb{R}_+^D$
+ Out flows: $\label{v:outFlow} \alpha^{out} \in \mathbb{R}_+^D$

Objective:

$$
  \label{o}
  \min \sum_{(i,j) \in D} \alpha_{i,j}^{in} d_{i,j}
$$

Flow conservation constraint:

$$
  \label{c:flowConservation}
  \forall i \in I,
    \sum_{j \in N_i} (\alpha_{i,j}^{in} - \alpha^{out}_{i,j})
      = a_i^{end} - a_i^{start}
$$
