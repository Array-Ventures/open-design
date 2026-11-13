# Document style

Private shared color logic for structured document editing and contained exports.
`/color` is pure sRGB math and types; its isolated Node consumer typecheck does
not load DOM declarations. `/browser` resolves CSS colors with Canvas and accepts
explicit document/element owners. Neither entry accesses services, files, React,
or a document at module initialization.

Readability repair applies only to unowned inherited foreground at each text
owner. Explicit foreground remains authoritative, including low-contrast colors.
Cell descriptors carry authored background only. Actual opaque color projection
uses the resolved canvas/background context, including alpha and modern colors.

Neutral print/export wrappers are qualified only for the known canonical
stylesheet and bounded inline presentation. Unknown authored selectors/layout
refuse Word normalization. PDF preserves the original layout but declines ink
repair. Quoted semicolons in inline declarations are conservatively refused,
not silently dropped. This is a current boundary, not full custom-CSS fidelity.

Default Markdown strike, footnote sections and unstyled horizontal rules retain
native semantics. Passive Pandoc MathML uses a bounded tag/attribute grammar and
stays outside HTML text/color annotation. Math with authored surrounding ink or
fill is refused for Word because that paint has no qualified native owner; PDF
keeps the original markup and declines repair. Unknown MathML, foreign content,
active attributes and styled separators remain outside this boundary.
