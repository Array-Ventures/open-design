import { insertionParentAllowed } from './insertion';
import { insertionPlacement } from './insertion-placement';

/** Placement only. The iframe proposes geometry; the source-owning host
 * validates the request and performs its normal conditional source write. */
export function buildInsertionBridge(): string {
  return `<script data-od-edit-bridge>(function(){
  var place = ${insertionPlacement.toString()};
  var parentAllowed = ${insertionParentAllowed.toString()};
  var armed = null, gesture = null, ghost = null, suppressClick = false;
  function post(data){ window.parent.postMessage(data, '*'); }
  function clear(){
    armed = null; gesture = null;
    if (ghost) ghost.remove(); ghost = null;
    document.documentElement.removeAttribute('data-od-inserting');
  }
  function cancel(){
    var request = armed; if (gesture) suppressClick = true; clear();
    if (request) post({type:'od-insert-cancelled', requestId:request.requestId});
  }
  function stop(event){ event.preventDefault(); event.stopImmediatePropagation(); }
  function surfaceFor(target){
    var element = target && target.nodeType === 1 ? target : target && target.parentElement;
    while (element && element !== document.documentElement) {
      var id = element.getAttribute('data-od-id') || element.getAttribute('data-od-source-path');
      if (element === document.body) id = '__body__';
      if (id && parentAllowed(element)
        && getComputedStyle(element).position !== 'static') {
        // Bounding-box mapping is valid for positive axis-aligned transforms.
        // Reject perspective, rotations, skew and reflection throughout the
        // containing chain instead of silently writing wrong coordinates.
        for (var ancestor = element; ancestor; ancestor = ancestor.parentElement) {
          var style = getComputedStyle(ancestor);
          if (style.perspective && style.perspective !== 'none') return null;
          if (style.transform && style.transform !== 'none') {
            try { var matrix = new DOMMatrixReadOnly(style.transform);
              if (!matrix.is2D || matrix.b !== 0 || matrix.c !== 0 || matrix.a <= 0 || matrix.d <= 0) return null;
            } catch (_) { return null; }
          }
          // Individual transform properties are independent of transform.
          if (style.rotate && style.rotate !== 'none' && style.rotate !== '0deg') return null;
          if (style.scale && style.scale !== 'none' && style.scale.split(/\\s+/).some(function(value){ return !(Number(value) > 0); })) return null;
        }
        var rect = element.getBoundingClientRect();
        return { element: element, id: id, surface: {
          rect:{left:rect.left,top:rect.top,width:rect.width,height:rect.height},
          offsetWidth:element.offsetWidth, offsetHeight:element.offsetHeight,
          clientWidth:element.clientWidth,clientHeight:element.clientHeight,
          clientLeft:element.clientLeft,clientTop:element.clientTop,
          scrollLeft:element.scrollLeft,scrollTop:element.scrollTop
        }};
      }
      element = element.parentElement;
    }
    return null;
  }
  function complete(end){
    if (!armed || !gesture) return;
    var request = armed, chosen = gesture.chosen;
    // Re-measure: scrolling or resize during a gesture retires it rather than
    // mixing two coordinate systems in one persisted object.
    var current = surfaceFor(chosen.element);
    if (!current || current.element !== chosen.element || JSON.stringify(current.surface) !== JSON.stringify(chosen.surface)) { cancel(); return; }
    var placement = place(chosen.surface, gesture.start, end, request.element, end === null ? 'center' : 'start');
    clear(); suppressClick = end !== null;
    if (!placement) { post({type:'od-insert-cancelled',requestId:request.requestId}); return; }
    post({type:'od-insert-placement',requestId:request.requestId,parentId:chosen.id,placement:placement});
  }
  window.addEventListener('message', function(event){
    if (event.source !== window.parent || !event.data) return;
    var data = event.data;
    if (data.type === 'od-edit-mode' && !data.enabled) { cancel(); return; }
    if (data.type === 'od-insert-cancel' && armed && data.requestId === armed.requestId) { cancel(); return; }
    if (data.type !== 'od-insert-arm' || typeof data.requestId !== 'string'
      || !document.documentElement.hasAttribute('data-od-edit-mode')
      || !data.element || !['text','image','table','shape'].includes(data.element.kind)) return;
    cancel(); armed = { requestId:data.requestId, element:data.element };
    document.documentElement.setAttribute('data-od-inserting','');
    post({type:'od-insert-armed',requestId:data.requestId});
  });
  window.addEventListener('pointerdown', function(event){
    if (!armed || event.button !== 0) return;
    stop(event);
    if (gesture) return;
    var chosen = surfaceFor(event.target);
    if (!chosen) { post({type:'od-insert-unavailable',requestId:armed.requestId}); return; }
    gesture = { chosen:chosen, start:{x:event.clientX,y:event.clientY}, pointerId:event.pointerId };
    try { chosen.element.setPointerCapture(event.pointerId); } catch (_) { /* Older engines still support in-canvas gestures. */ }
    ghost = document.createElement('div'); ghost.setAttribute('data-od-edit-bridge','');
    ghost.setAttribute('aria-hidden','true');
    ghost.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;outline:1px solid Highlight;box-sizing:border-box;';
    document.documentElement.appendChild(ghost);
  }, true);
  window.addEventListener('pointermove', function(event){
    if (!armed) return;
    stop(event);
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    var result = place(gesture.chosen.surface,gesture.start,{x:event.clientX,y:event.clientY},armed.element);
    if (!result || !ghost) return;
    var surface = gesture.chosen.surface, sx=surface.rect.width/surface.offsetWidth, sy=surface.rect.height/surface.offsetHeight;
    Object.assign(ghost.style, {left:(surface.rect.left+(result.left-surface.scrollLeft+surface.clientLeft)*sx)+'px',
      top:(surface.rect.top+(result.top-surface.scrollTop+surface.clientTop)*sy)+'px',width:(result.width*sx)+'px',height:(result.height*sy)+'px'});
  }, true);
  window.addEventListener('pointerup', function(event){
    if (!armed) return;
    stop(event);
    if (gesture && gesture.pointerId === event.pointerId) complete({x:event.clientX,y:event.clientY});
  }, true);
  window.addEventListener('lostpointercapture', function(event){ if (armed && gesture && gesture.pointerId === event.pointerId) cancel(); }, true);
  window.addEventListener('pointercancel', function(event){ if (armed) { stop(event); cancel(); } }, true);
  window.addEventListener('click', function(event){
    if (!armed && !suppressClick) return;
    suppressClick = false; stop(event);
  }, true);
  window.addEventListener('keydown', function(event){
    if (!armed) return;
    if (event.key === 'Escape') { stop(event); cancel(); return; }
    if (event.key !== 'Enter' && event.key !== ' ') return;
    stop(event);
    var center = {x:innerWidth/2,y:innerHeight/2};
    var chosen = surfaceFor(document.elementFromPoint(center.x,center.y));
    if (!chosen) { post({type:'od-insert-unavailable',requestId:armed.requestId}); return; }
    gesture = {chosen:chosen,start:center}; complete(null);
  }, true);
  window.addEventListener('blur', function(){ if (gesture) cancel(); });
})();</script>`;
}
