# Document page width

The reference document's More menu exposes “Make page wide”. Our structured
editor now offers that action in its existing More menu, with “Use standard page
width” as the return action. No additional toolbar row is introduced.

Wide mode removes the editor page's 824px cap while retaining its existing
padding and scroll owner. It uses the space left by the sidebar, chat and review
gutter rather than changing those layouts. Phone layouts keep the same padding;
the preference becomes visible when more width is available.

This is a viewer preference, not a source edit. It is stored in browser storage
under the current viewer, project and file identity. It survives an editor
remount in that browser but is not a cross-device account setting. If browser
storage is unavailable, it remains usable for the mounted editor. It does not
alter HTML/Markdown, conditional writes, native selection, text Undo/Redo or
export page geometry. The implementation adds no permission or capability.

The reference menu was inspected read-only; its width action was not invoked.
Its exact persistence, export and history semantics remain unverified, so this
does not claim those match Claude. Date behavior remains a separate gap.

## Source verification

Three mounted-editor cases genuinely failed on unchanged main because the width
action was absent. They now cover source/selection/text-history preservation,
viewer/project/file scoping, remount persistence and unavailable storage. Two
additional cases exercise the actual French and Arabic controls. Existing font,
suggestion and review-placement cases remain intact.

The first post-edit check used the wrong directory for the locale-writing
command, so no catalog entries were written and its missing-label failures are
retained as setup evidence. The final command writes the two keys into all 19
typed catalogs. No assertion or test baseline was loosened.

Actual packaged Light/Dark, narrow/wide, chat/fullscreen, reviewer acceptance and
source-byte checks remain pending at this source checkpoint. No preview,
installer pin, distribution or production change is claimed here.
