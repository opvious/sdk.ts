# Diet model

## Subsets

+ Recipes $\label{d:recipes} R$
+ Nutrients $\label{d:nutrients} N$

## Parameters

+ Minimum nutrients $\label{p:minimalNutrients} m \in \mathbb{R}_+^N$
+ Nutrients per recipe $\label{p:nutrientsPerRecipe} p \in \mathbb{R}_+^{N \times R}$
+ Cost per recipe $\label{p:costPerRecipe} c \in \mathbb{R}_+^R$

## Variables

+ Quantity of each recipe $\label{v:quantityOfRecipe} \alpha \in \mathbb{N}^R$

## Objective

Minimize total cost:

$$
  \label{o} \min \sum_{r \in R} c_r \alpha_r
$$

## Constraint

Have at least the minimum quantity of each nutrient:

$$
  \label{c:enoughNutrients}
  \forall n \in N,
    \sum_{r \in R} \alpha_r p_{n,r} \geq m_n
$$
