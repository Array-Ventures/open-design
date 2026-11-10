# Embedded Studio fonts

The embedded package includes the two unmodified Albert Sans variable fonts and
`AlbertSans-OFL.txt`. Their name tables identify Copyright 2021 The Albert Sans
Project Authors, Andreas Rasmussen / a.Foundry, and SIL Open Font License 1.1.
The accompanying OFL notice is retained verbatim from the authors' repository:
https://github.com/usted/Albert-Sans/blob/main/OFL.txt (Copyright 2023).

The embedded font allowlist is `apps/web/embedded-fonts.json`. The upstream
`JiduMonoPro-Regular.otf` is excluded from this package: its name table identifies
CoType Foundry and an EULA URL, and no matching redistribution notice is supplied
in the repository. Its embedded CSS face is omitted; the existing system
monospace fallback applies. The ordinary upstream build is unaffected.

The embedded Evebot UI also includes the unmodified Inter variable WOFF2 latin,
latin-ext, Cyrillic and Greek subsets already bundled by Evebot, sourced from
`@fontsource-variable/inter` 5.3.0. Copyright 2016 The Inter Project Authors
(https://github.com/rsms/inter), SIL Open Font License 1.1.
`LICENSE-Inter.txt` is retained beside the font files. These faces apply to the
Studio workspace only; authored documents keep their own font declarations.
