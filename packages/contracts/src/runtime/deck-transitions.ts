export const DECK_TRANSITIONS = ['none', 'fade', 'push', 'magic-move'] as const;
export type DeckTransition = typeof DECK_TRANSITIONS[number];

// Kept self-contained inside the artifact document. Native snapshots avoid
// cloning interactive content or exposing the surrounding host/chat surface.
export const DECK_TRANSITION_RUNTIME = `
  function runDeckTransition(stage, previous, next, update) {
    stage._cancelTransition();
    var generation = stage._transitionGeneration;
    var mode = stage.getAttribute('transition');
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!previous || previous === next || ['fade','push','magic-move'].indexOf(mode) < 0 || reduced ||
        stage.hasAttribute('noscale') || document.documentElement.hasAttribute('data-od-edit-mode') ||
        typeof document.startViewTransition !== 'function') { update(); return; }
    var restores = [];
    function restore() {
      restores.forEach(function(item) {
        if (item.element.style.getPropertyValue('view-transition-name') !== item.name) return;
        if (item.value) item.element.style.setProperty('view-transition-name', item.value, item.priority);
        else item.element.style.removeProperty('view-transition-name');
        if (!item.hadStyle && !item.element.getAttribute('style')) item.element.removeAttribute('style');
      });
      restores = [];
    }
    function name(element, value) {
      restores.push({element:element,name:value,value:element.style.getPropertyValue('view-transition-name'),priority:element.style.getPropertyPriority('view-transition-name'),hadStyle:element.hasAttribute('style')});
      element.style.setProperty('view-transition-name', value);
    }
    function candidates(slide) {
      var result = new Map();
      slide.querySelectorAll('[data-od-morph-id],[data-od-id],img,svg,h1,h2,h3,h4,h5,h6,p').forEach(function(element) {
        var explicit = element.getAttribute('data-od-morph-id');
        var semantic = element.getAttribute('aria-label') || (element.localName === 'img' ? element.getAttribute('src') : (element.textContent || '').trim());
        var identity = explicit || semantic || element.getAttribute('data-od-id') || element.id;
        if (!identity) return;
        var key = explicit ? 'explicit:' + explicit : element.localName + ':' + identity;
        // Repeated labels are ambiguous; never morph an arbitrary duplicate.
        result.set(key, result.has(key) ? null : element);
      });
      return result;
    }
    var pairs = [];
    if (mode === 'magic-move') {
      var before = candidates(previous), after = candidates(next);
      before.forEach(function(element, key) { if (element && after.get(key)) pairs.push([element, after.get(key)]); });
      pairs.forEach(function(pair, index) { name(pair[0], 'od-deck-object-' + index); });
    }
    stage._transitionCleanup = restore;
    try {
      var backwards = stage._slides.indexOf(next) < stage._slides.indexOf(previous);
      var transition = document.startViewTransition({
        types: ['od-deck-' + mode, backwards ? 'od-deck-backward' : 'od-deck-forward'],
        update: function() {
          if (generation !== stage._transitionGeneration || !stage.isConnected) return;
          restore(); update();
          pairs.forEach(function(pair, index) { name(pair[1], 'od-deck-object-' + index); });
        }
      });
      stage._transition = transition;
      transition.ready.catch(function() {});
      function finish() {
        if (generation !== stage._transitionGeneration) return;
        restore(); stage._transition = null; stage._transitionCleanup = null;
      }
      transition.finished.then(finish, finish);
    } catch (_) { restore(); stage._transitionCleanup = null; update(); }
  }
`;

export const DECK_TRANSITION_CSS = `
html:active-view-transition-type(od-deck-fade,od-deck-push,od-deck-magic-move)::view-transition-group(*){animation-duration:350ms;animation-timing-function:ease-in-out;}
html:active-view-transition-type(od-deck-push)::view-transition-old(root){animation-name:od-deck-exit-forward;}
html:active-view-transition-type(od-deck-push)::view-transition-new(root){animation-name:od-deck-enter-forward;}
html:active-view-transition-type(od-deck-push):active-view-transition-type(od-deck-backward)::view-transition-old(root){animation-name:od-deck-exit-backward;}
html:active-view-transition-type(od-deck-push):active-view-transition-type(od-deck-backward)::view-transition-new(root){animation-name:od-deck-enter-backward;}
@keyframes od-deck-exit-forward{to{transform:translateX(-100%);}}
@keyframes od-deck-enter-forward{from{transform:translateX(100%);}}
@keyframes od-deck-exit-backward{to{transform:translateX(100%);}}
@keyframes od-deck-enter-backward{from{transform:translateX(-100%);}}
@media(prefers-reduced-motion:reduce){html:active-view-transition-type(od-deck-fade,od-deck-push,od-deck-magic-move)::view-transition-group(*){animation-duration:0s;}}
`;
