---
title: Ordinary GFM fixture
author: Owned fixture
---

# Heading one

## Heading two

### Heading three

#### Heading four

##### Heading five

###### Heading six

Plain paragraph with **strong**, *emphasis*, ~~strikethrough~~, `inline code`,
a soft break, a hard break  
a second line, and an escaped \*literal\* &amp; entity.

:smile: and literal 😃.

> Block quote with a nested paragraph.
>
> - Quoted list

> [!NOTE]
> Ordinary alert content.

> [!TIP]
> Helpful tip.

> [!IMPORTANT]
> Important content.

> [!WARNING]
> Warning content.

> [!CAUTION]
> Caution content.

- Tight unordered
- Another item
  - Nested unordered

1. Ordered item
2. Next item

7. Ordered start seven
8. Next item

- Loose item paragraph.

  Another paragraph in the same item.

- Last loose item.

- [x] Completed checklist
- [ ] Pending checklist

[Named link](https://fixture.test/owned "Owned title"), <https://fixture.test/auto>,
https://fixture.test/bare and www.fixture.test, <owned@fixture.test>.

![Owned image alt](owned-image.png "Owned image title")

| Left | Center | Right |
| :--- | :----: | ----: |
| A | B | C |
| escaped \| pipe | ~~deleted~~ | **bold** |

---

```javascript
const value = 1;
console.log(value);
```

    indented code
    next line

Footnote reference[^owned] and another[^multi].

[^owned]: Owned footnote text.

[^multi]: Footnote first paragraph.

    Second footnote paragraph.

Inline math $x^2 + y_1 = \alpha$ and $\frac{1}{2}$.

$$
\sum_{i=1}^{n} i = \frac{n(n+1)}{2}
$$

Inline GFM math $`a+b`$.

```math
x^2 + y^2 = z^2
```

## Ordinary math forms

$\sqrt{x}$, $\sqrt[3]{y}$, $a_{b}^{c}$, $\text{units}$, $a\quad b$,
$\left( x \right)$, $\hat{x}$, $\bar{x}$, $\vec{x}$, $\dot{x}$,
$\overbrace{x+y}^{n}$, $\underbrace{x+y}_{n}$, $\overset{a}{=}$,
$\underset{x}{\lim}$, $\phantom{x}$, $\binom{n}{k}$.

$$
\begin{pmatrix}
a & b \\
c & d
\end{pmatrix}
$$

## Ordinary mathematical alphabets and spacing

Ordinary mathematical alphabets $\mathbf{x}$, $\mathit{x}$, $\mathrm{d}$, $\mathbb{R}$, $\mathcal{F}$, $\mathfrak{g}$, $\mathsf{x}$, $\mathtt{x}$.

Ordinary spacing $x\!y$, $a\,b$ and explicit style $\displaystyle\sum_i x_i$.
