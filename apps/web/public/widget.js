(function(){"use strict";var W,v,ue,j,pe,fe,me,he,ee,te,oe,M={},be=[],Ve=/acit|ex(?:s|g|n|p|$)|rph|grid|ows|mnc|ntw|ine[ch]|zoo|^ord|itera/i,R=Array.isArray;function A(e,t){for(var o in t)e[o]=t[o];return e}function re(e){e&&e.parentNode&&e.parentNode.removeChild(e)}function Ye(e,t,o){var r,a,i,l={};for(i in t)i=="key"?r=t[i]:i=="ref"?a=t[i]:l[i]=t[i];if(arguments.length>2&&(l.children=arguments.length>3?W.call(arguments,2):o),typeof e=="function"&&e.defaultProps!=null)for(i in e.defaultProps)l[i]===void 0&&(l[i]=e.defaultProps[i]);return O(e,l,r,a,null)}function O(e,t,o,r,a){var i={type:e,props:t,key:o,ref:r,__k:null,__:null,__b:0,__e:null,__c:null,constructor:void 0,__v:a??++ue,__i:-1,__u:0};return a==null&&v.vnode!=null&&v.vnode(i),i}function K(e){return e.children}function V(e,t){this.props=e,this.context=t}function L(e,t){if(t==null)return e.__?L(e.__,e.__i+1):null;for(var o;t<e.__k.length;t++)if((o=e.__k[t])!=null&&o.__e!=null)return o.__e;return typeof e.type=="function"?L(e):null}function ge(e){var t,o;if((e=e.__)!=null&&e.__c!=null){for(e.__e=e.__c.base=null,t=0;t<e.__k.length;t++)if((o=e.__k[t])!=null&&o.__e!=null){e.__e=e.__c.base=o.__e;break}return ge(e)}}function ve(e){(!e.__d&&(e.__d=!0)&&j.push(e)&&!Y.__r++||pe!=v.debounceRendering)&&((pe=v.debounceRendering)||fe)(Y)}function Y(){for(var e,t,o,r,a,i,l,d=1;j.length;)j.length>d&&j.sort(me),e=j.shift(),d=j.length,e.__d&&(o=void 0,r=void 0,a=(r=(t=e).__v).__e,i=[],l=[],t.__P&&((o=A({},r)).__v=r.__v+1,v.vnode&&v.vnode(o),ie(t.__P,o,r,t.__n,t.__P.namespaceURI,32&r.__u?[a]:null,i,a??L(r),!!(32&r.__u),l),o.__v=r.__v,o.__.__k[o.__i]=o,Ne(i,o,l),r.__e=r.__=null,o.__e!=a&&ge(o)));Y.__r=0}function xe(e,t,o,r,a,i,l,d,p,c,m){var n,h,u,y,S,w,b,g=r&&r.__k||be,_=t.length;for(p=Je(o,t,g,p,_),n=0;n<_;n++)(u=o.__k[n])!=null&&(h=u.__i==-1?M:g[u.__i]||M,u.__i=n,w=ie(e,u,h,a,i,l,d,p,c,m),y=u.__e,u.ref&&h.ref!=u.ref&&(h.ref&&ae(h.ref,null,u),m.push(u.ref,u.__c||y,u)),S==null&&y!=null&&(S=y),(b=!!(4&u.__u))||h.__k===u.__k?p=ye(u,p,e,b):typeof u.type=="function"&&w!==void 0?p=w:y&&(p=y.nextSibling),u.__u&=-7);return o.__e=S,p}function Je(e,t,o,r,a){var i,l,d,p,c,m=o.length,n=m,h=0;for(e.__k=new Array(a),i=0;i<a;i++)(l=t[i])!=null&&typeof l!="boolean"&&typeof l!="function"?(typeof l=="string"||typeof l=="number"||typeof l=="bigint"||l.constructor==String?l=e.__k[i]=O(null,l,null,null,null):R(l)?l=e.__k[i]=O(K,{children:l},null,null,null):l.constructor===void 0&&l.__b>0?l=e.__k[i]=O(l.type,l.props,l.key,l.ref?l.ref:null,l.__v):e.__k[i]=l,p=i+h,l.__=e,l.__b=e.__b+1,d=null,(c=l.__i=Qe(l,o,p,n))!=-1&&(n--,(d=o[c])&&(d.__u|=2)),d==null||d.__v==null?(c==-1&&(a>m?h--:a<m&&h++),typeof l.type!="function"&&(l.__u|=4)):c!=p&&(c==p-1?h--:c==p+1?h++:(c>p?h--:h++,l.__u|=4))):e.__k[i]=null;if(n)for(i=0;i<m;i++)(d=o[i])!=null&&!(2&d.__u)&&(d.__e==r&&(r=L(d)),Se(d,d));return r}function ye(e,t,o,r){var a,i;if(typeof e.type=="function"){for(a=e.__k,i=0;a&&i<a.length;i++)a[i]&&(a[i].__=e,t=ye(a[i],t,o,r));return t}e.__e!=t&&(r&&(t&&e.type&&!t.parentNode&&(t=L(e)),o.insertBefore(e.__e,t||null)),t=e.__e);do t=t&&t.nextSibling;while(t!=null&&t.nodeType==8);return t}function Qe(e,t,o,r){var a,i,l,d=e.key,p=e.type,c=t[o],m=c!=null&&(2&c.__u)==0;if(c===null&&d==null||m&&d==c.key&&p==c.type)return o;if(r>(m?1:0)){for(a=o-1,i=o+1;a>=0||i<t.length;)if((c=t[l=a>=0?a--:i++])!=null&&!(2&c.__u)&&d==c.key&&p==c.type)return l}return-1}function ke(e,t,o){t[0]=="-"?e.setProperty(t,o??""):e[t]=o==null?"":typeof o!="number"||Ve.test(t)?o:o+"px"}function J(e,t,o,r,a){var i,l;e:if(t=="style")if(typeof o=="string")e.style.cssText=o;else{if(typeof r=="string"&&(e.style.cssText=r=""),r)for(t in r)o&&t in o||ke(e.style,t,"");if(o)for(t in o)r&&o[t]==r[t]||ke(e.style,t,o[t])}else if(t[0]=="o"&&t[1]=="n")i=t!=(t=t.replace(he,"$1")),l=t.toLowerCase(),t=l in e||t=="onFocusOut"||t=="onFocusIn"?l.slice(2):t.slice(2),e.l||(e.l={}),e.l[t+i]=o,o?r?o.u=r.u:(o.u=ee,e.addEventListener(t,i?oe:te,i)):e.removeEventListener(t,i?oe:te,i);else{if(a=="http://www.w3.org/2000/svg")t=t.replace(/xlink(H|:h)/,"h").replace(/sName$/,"s");else if(t!="width"&&t!="height"&&t!="href"&&t!="list"&&t!="form"&&t!="tabIndex"&&t!="download"&&t!="rowSpan"&&t!="colSpan"&&t!="role"&&t!="popover"&&t in e)try{e[t]=o??"";break e}catch{}typeof o=="function"||(o==null||o===!1&&t[4]!="-"?e.removeAttribute(t):e.setAttribute(t,t=="popover"&&o==1?"":o))}}function we(e){return function(t){if(this.l){var o=this.l[t.type+e];if(t.t==null)t.t=ee++;else if(t.t<o.u)return;return o(v.event?v.event(t):t)}}}function ie(e,t,o,r,a,i,l,d,p,c){var m,n,h,u,y,S,w,b,g,_,x,f,N,q,D,T,B,P=t.type;if(t.constructor!==void 0)return null;128&o.__u&&(p=!!(32&o.__u),i=[d=t.__e=o.__e]),(m=v.__b)&&m(t);e:if(typeof P=="function")try{if(b=t.props,g="prototype"in P&&P.prototype.render,_=(m=P.contextType)&&r[m.__c],x=m?_?_.props.value:m.__:r,o.__c?w=(n=t.__c=o.__c).__=n.__E:(g?t.__c=n=new P(b,x):(t.__c=n=new V(b,x),n.constructor=P,n.render=Ze),_&&_.sub(n),n.state||(n.state={}),n.__n=r,h=n.__d=!0,n.__h=[],n._sb=[]),g&&n.__s==null&&(n.__s=n.state),g&&P.getDerivedStateFromProps!=null&&(n.__s==n.state&&(n.__s=A({},n.__s)),A(n.__s,P.getDerivedStateFromProps(b,n.__s))),u=n.props,y=n.state,n.__v=t,h)g&&P.getDerivedStateFromProps==null&&n.componentWillMount!=null&&n.componentWillMount(),g&&n.componentDidMount!=null&&n.__h.push(n.componentDidMount);else{if(g&&P.getDerivedStateFromProps==null&&b!==u&&n.componentWillReceiveProps!=null&&n.componentWillReceiveProps(b,x),t.__v==o.__v||!n.__e&&n.shouldComponentUpdate!=null&&n.shouldComponentUpdate(b,n.__s,x)===!1){for(t.__v!=o.__v&&(n.props=b,n.state=n.__s,n.__d=!1),t.__e=o.__e,t.__k=o.__k,t.__k.some(function(F){F&&(F.__=t)}),f=0;f<n._sb.length;f++)n.__h.push(n._sb[f]);n._sb=[],n.__h.length&&l.push(n);break e}n.componentWillUpdate!=null&&n.componentWillUpdate(b,n.__s,x),g&&n.componentDidUpdate!=null&&n.__h.push(function(){n.componentDidUpdate(u,y,S)})}if(n.context=x,n.props=b,n.__P=e,n.__e=!1,N=v.__r,q=0,g){for(n.state=n.__s,n.__d=!1,N&&N(t),m=n.render(n.props,n.state,n.context),D=0;D<n._sb.length;D++)n.__h.push(n._sb[D]);n._sb=[]}else do n.__d=!1,N&&N(t),m=n.render(n.props,n.state,n.context),n.state=n.__s;while(n.__d&&++q<25);n.state=n.__s,n.getChildContext!=null&&(r=A(A({},r),n.getChildContext())),g&&!h&&n.getSnapshotBeforeUpdate!=null&&(S=n.getSnapshotBeforeUpdate(u,y)),T=m,m!=null&&m.type===K&&m.key==null&&(T=Ce(m.props.children)),d=xe(e,R(T)?T:[T],t,o,r,a,i,l,d,p,c),n.base=t.__e,t.__u&=-161,n.__h.length&&l.push(n),w&&(n.__E=n.__=null)}catch(F){if(t.__v=null,p||i!=null)if(F.then){for(t.__u|=p?160:128;d&&d.nodeType==8&&d.nextSibling;)d=d.nextSibling;i[i.indexOf(d)]=null,t.__e=d}else{for(B=i.length;B--;)re(i[B]);ne(t)}else t.__e=o.__e,t.__k=o.__k,F.then||ne(t);v.__e(F,t,o)}else i==null&&t.__v==o.__v?(t.__k=o.__k,t.__e=o.__e):d=t.__e=Ge(o.__e,t,o,r,a,i,l,p,c);return(m=v.diffed)&&m(t),128&t.__u?void 0:d}function ne(e){e&&e.__c&&(e.__c.__e=!0),e&&e.__k&&e.__k.forEach(ne)}function Ne(e,t,o){for(var r=0;r<o.length;r++)ae(o[r],o[++r],o[++r]);v.__c&&v.__c(t,e),e.some(function(a){try{e=a.__h,a.__h=[],e.some(function(i){i.call(a)})}catch(i){v.__e(i,a.__v)}})}function Ce(e){return typeof e!="object"||e==null||e.__b&&e.__b>0?e:R(e)?e.map(Ce):A({},e)}function Ge(e,t,o,r,a,i,l,d,p){var c,m,n,h,u,y,S,w=o.props||M,b=t.props,g=t.type;if(g=="svg"?a="http://www.w3.org/2000/svg":g=="math"?a="http://www.w3.org/1998/Math/MathML":a||(a="http://www.w3.org/1999/xhtml"),i!=null){for(c=0;c<i.length;c++)if((u=i[c])&&"setAttribute"in u==!!g&&(g?u.localName==g:u.nodeType==3)){e=u,i[c]=null;break}}if(e==null){if(g==null)return document.createTextNode(b);e=document.createElementNS(a,g,b.is&&b),d&&(v.__m&&v.__m(t,i),d=!1),i=null}if(g==null)w===b||d&&e.data==b||(e.data=b);else{if(i=i&&W.call(e.childNodes),!d&&i!=null)for(w={},c=0;c<e.attributes.length;c++)w[(u=e.attributes[c]).name]=u.value;for(c in w)if(u=w[c],c!="children"){if(c=="dangerouslySetInnerHTML")n=u;else if(!(c in b)){if(c=="value"&&"defaultValue"in b||c=="checked"&&"defaultChecked"in b)continue;J(e,c,null,u,a)}}for(c in b)u=b[c],c=="children"?h=u:c=="dangerouslySetInnerHTML"?m=u:c=="value"?y=u:c=="checked"?S=u:d&&typeof u!="function"||w[c]===u||J(e,c,u,w[c],a);if(m)d||n&&(m.__html==n.__html||m.__html==e.innerHTML)||(e.innerHTML=m.__html),t.__k=[];else if(n&&(e.innerHTML=""),xe(t.type=="template"?e.content:e,R(h)?h:[h],t,o,r,g=="foreignObject"?"http://www.w3.org/1999/xhtml":a,i,l,i?i[0]:o.__k&&L(o,0),d,p),i!=null)for(c=i.length;c--;)re(i[c]);d||(c="value",g=="progress"&&y==null?e.removeAttribute("value"):y!=null&&(y!==e[c]||g=="progress"&&!y||g=="option"&&y!=w[c])&&J(e,c,y,w[c],a),c="checked",S!=null&&S!=e[c]&&J(e,c,S,w[c],a))}return e}function ae(e,t,o){try{if(typeof e=="function"){var r=typeof e.__u=="function";r&&e.__u(),r&&t==null||(e.__u=e(t))}else e.current=t}catch(a){v.__e(a,o)}}function Se(e,t,o){var r,a;if(v.unmount&&v.unmount(e),(r=e.ref)&&(r.current&&r.current!=e.__e||ae(r,null,t)),(r=e.__c)!=null){if(r.componentWillUnmount)try{r.componentWillUnmount()}catch(i){v.__e(i,t)}r.base=r.__P=null}if(r=e.__k)for(a=0;a<r.length;a++)r[a]&&Se(r[a],t,o||typeof e.type!="function");o||re(e.__e),e.__c=e.__=e.__e=void 0}function Ze(e,t,o){return this.constructor(e,o)}function se(e,t,o){var r,a,i,l;t==document&&(t=document.documentElement),v.__&&v.__(e,t),a=(r=!1)?null:t.__k,i=[],l=[],ie(t,e=t.__k=Ye(K,null,[e]),a||M,M,t.namespaceURI,a?null:t.firstChild?W.call(t.childNodes):null,i,a?a.__e:t.firstChild,r,l),Ne(i,e,l)}W=be.slice,v={__e:function(e,t,o,r){for(var a,i,l;t=t.__;)if((a=t.__c)&&!a.__)try{if((i=a.constructor)&&i.getDerivedStateFromError!=null&&(a.setState(i.getDerivedStateFromError(e)),l=a.__d),a.componentDidCatch!=null&&(a.componentDidCatch(e,r||{}),l=a.__d),l)return a.__E=a}catch(d){e=d}throw e}},ue=0,V.prototype.setState=function(e,t){var o;o=this.__s!=null&&this.__s!=this.state?this.__s:this.__s=A({},this.state),typeof e=="function"&&(e=e(A({},o),this.props)),e&&A(o,e),e!=null&&this.__v&&(t&&this._sb.push(t),ve(this))},V.prototype.forceUpdate=function(e){this.__v&&(this.__e=!0,e&&this.__h.push(e),ve(this))},V.prototype.render=K,j=[],fe=typeof Promise=="function"?Promise.prototype.then.bind(Promise.resolve()):setTimeout,me=function(e,t){return e.__v.__b-t.__v.__b},Y.__r=0,he=/(PointerCapture)$|Capture$/i,ee=0,te=we(!1),oe=we(!0);var Xe=0;function s(e,t,o,r,a,i){t||(t={});var l,d,p=t;if("ref"in p)for(d in p={},t)d=="ref"?l=t[d]:p[d]=t[d];var c={type:e,props:p,key:o,ref:l,__k:null,__:null,__b:0,__e:null,__c:null,constructor:void 0,__v:--Xe,__i:-1,__u:0,__source:a,__self:i};if(typeof e=="function"&&(l=e.defaultProps))for(d in l)p[d]===void 0&&(p[d]=l[d]);return v.vnode&&v.vnode(c),c}var Q,k,le,Ie,ce=0,$e=[],C=v,Pe=C.__b,Ee=C.__r,qe=C.diffed,Ae=C.__c,Ue=C.unmount,Te=C.__;function ze(e,t){C.__h&&C.__h(k,e,ce||t),ce=0;var o=k.__H||(k.__H={__:[],__h:[]});return e>=o.__.length&&o.__.push({}),o.__[e]}function $(e){return ce=1,et(Fe,e)}function et(e,t,o){var r=ze(Q++,2);if(r.t=e,!r.__c&&(r.__=[Fe(void 0,t),function(d){var p=r.__N?r.__N[0]:r.__[0],c=r.t(p,d);p!==c&&(r.__N=[c,r.__[1]],r.__c.setState({}))}],r.__c=k,!k.__f)){var a=function(d,p,c){if(!r.__c.__H)return!0;var m=r.__c.__H.__.filter(function(h){return!!h.__c});if(m.every(function(h){return!h.__N}))return!i||i.call(this,d,p,c);var n=r.__c.props!==d;return m.forEach(function(h){if(h.__N){var u=h.__[0];h.__=h.__N,h.__N=void 0,u!==h.__[0]&&(n=!0)}}),i&&i.call(this,d,p,c)||n};k.__f=!0;var i=k.shouldComponentUpdate,l=k.componentWillUpdate;k.componentWillUpdate=function(d,p,c){if(this.__e){var m=i;i=void 0,a(d,p,c),i=m}l&&l.call(this,d,p,c)},k.shouldComponentUpdate=a}return r.__N||r.__}function tt(e,t){var o=ze(Q++,3);!C.__s&&it(o.__H,t)&&(o.__=e,o.u=t,k.__H.__h.push(o))}function ot(){for(var e;e=$e.shift();)if(e.__P&&e.__H)try{e.__H.__h.forEach(G),e.__H.__h.forEach(de),e.__H.__h=[]}catch(t){e.__H.__h=[],C.__e(t,e.__v)}}C.__b=function(e){k=null,Pe&&Pe(e)},C.__=function(e,t){e&&t.__k&&t.__k.__m&&(e.__m=t.__k.__m),Te&&Te(e,t)},C.__r=function(e){Ee&&Ee(e),Q=0;var t=(k=e.__c).__H;t&&(le===k?(t.__h=[],k.__h=[],t.__.forEach(function(o){o.__N&&(o.__=o.__N),o.u=o.__N=void 0})):(t.__h.forEach(G),t.__h.forEach(de),t.__h=[],Q=0)),le=k},C.diffed=function(e){qe&&qe(e);var t=e.__c;t&&t.__H&&(t.__H.__h.length&&($e.push(t)!==1&&Ie===C.requestAnimationFrame||((Ie=C.requestAnimationFrame)||rt)(ot)),t.__H.__.forEach(function(o){o.u&&(o.__H=o.u),o.u=void 0})),le=k=null},C.__c=function(e,t){t.some(function(o){try{o.__h.forEach(G),o.__h=o.__h.filter(function(r){return!r.__||de(r)})}catch(r){t.some(function(a){a.__h&&(a.__h=[])}),t=[],C.__e(r,o.__v)}}),Ae&&Ae(e,t)},C.unmount=function(e){Ue&&Ue(e);var t,o=e.__c;o&&o.__H&&(o.__H.__.forEach(function(r){try{G(r)}catch(a){t=a}}),o.__H=void 0,t&&C.__e(t,o.__v))};var De=typeof requestAnimationFrame=="function";function rt(e){var t,o=function(){clearTimeout(r),De&&cancelAnimationFrame(t),setTimeout(e)},r=setTimeout(o,35);De&&(t=requestAnimationFrame(o))}function G(e){var t=k,o=e.__c;typeof o=="function"&&(e.__c=void 0,o()),k=t}function de(e){var t=k;e.__c=e.__(),k=t}function it(e,t){return!e||e.length!==t.length||t.some(function(o,r){return o!==e[r]})}function Fe(e,t){return typeof t=="function"?t(e):t}const nt="";function at(e,t){const o={};for(const r of e){if(!r.required)continue;const a=t[r.fieldId];if(a==null||a===""){o[r.fieldId]=`${r.label} is required`;continue}if(Array.isArray(a)&&a.length===0){o[r.fieldId]=`${r.label} is required`;continue}}return o}function He({tenantKey:e,serviceId:t,apiUrl:o,onClose:r,inline:a}){const[i,l]=$("loading"),[d,p]=$(null),[c,m]=$(null),[n,h]=$(null),[u,y]=$(t||""),[S,w]=$(""),[b,g]=$(""),[_,x]=$(""),[f,N]=$(""),[q,D]=$(""),[T,B]=$(""),[P,F]=$({}),Re=o||nt;tt(()=>{Oe()},[e]);async function Oe(){var H;try{const z=await fetch(`${Re}/api/public/widget/config?tenantKey=${e}`),E=await z.json();if(!z.ok){m(((H=E.error)==null?void 0:H.message)||"Failed to load widget"),l("error");return}p(E),t?(y(t),l("details")):E.services.length===1?(y(E.services[0].id),l("details")):l("service")}catch(z){console.error("[Widget] Failed to load config:",z),m("Failed to connect to server"),l("error")}}async function yt(){var z;if(!d)return;l("submitting");const H={serviceId:u,customer:{name:S,email:b,phone:_||void 0},job:{address:f||void 0,postcodeOrZip:q||void 0,answers:[...T?[{fieldId:"_project_description",value:T}]:[],...Object.entries(P).map(([E,X])=>({fieldId:E,value:X}))]},assetIds:[]};try{const E=await fetch(`${Re}/api/public/quotes`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({tenantKey:e,...H})}),X=await E.json();if(!E.ok){m(((z=X.error)==null?void 0:z.message)||"Failed to submit quote request"),l("error");return}h(X),l("success")}catch(E){console.error("[Widget] Failed to submit:",E),m("Failed to submit quote request"),l("error")}}function kt(H,z){F(E=>({...E,[H]:z}))}const wt=["service","details","contact"].includes(i),Ke=d&&d.services.length>1,Nt=Ke?["Service","Details","Contact"]:["Details","Contact"],Ct=Ke?i==="service"?0:i==="details"?1:2:i==="details"?0:1;return s("div",{className:`estimator-widget ${a?"estimator-widget-inline":""}`,children:[!a&&s("div",{className:"estimator-header",children:[s("h2",{children:(d==null?void 0:d.tenantName)||"Get a Quote"}),s("button",{className:"estimator-close",onClick:r,"aria-label":"Close",children:"×"})]}),s("div",{className:"estimator-body",children:[wt&&s(st,{steps:Nt,currentStep:Ct}),i==="loading"&&s(lt,{}),i==="error"&&s(ct,{message:c,onRetry:Oe}),i==="service"&&d&&s(dt,{services:d.services,selected:u,onSelect:H=>{y(H),l("details")}}),i==="details"&&d&&s(_t,{fields:d.fields,answers:P,jobAddress:f,jobPostcode:q,jobDescription:T,onFieldChange:kt,onAddressChange:N,onPostcodeChange:D,onDescriptionChange:B,onBack:()=>d.services.length>1?l("service"):null,onNext:()=>l("contact"),showBack:d.services.length>1}),i==="contact"&&s(ut,{name:S,email:b,phone:_,onNameChange:w,onEmailChange:g,onPhoneChange:x,onBack:()=>l("details"),onSubmit:yt}),i==="submitting"&&s(pt,{}),i==="success"&&n&&s(ft,{quoteUrl:n.quoteViewUrl,onClose:r,inline:a})]})]})}function st({steps:e,currentStep:t}){return s("div",{className:"estimator-progress",children:e.map((o,r)=>{const a=r===t,i=r<t;return s("div",{className:"estimator-progress-item",children:[s("div",{className:`estimator-progress-circle ${i?"completed":a?"active":""}`,children:i?s("svg",{viewBox:"0 0 20 20",fill:"currentColor",width:"12",height:"12",children:s("path",{fillRule:"evenodd",d:"M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z",clipRule:"evenodd"})}):r+1}),s("span",{className:`estimator-progress-label ${a||i?"active":""}`,children:o}),r<e.length-1&&s("div",{className:`estimator-progress-line ${r<t?"completed":""}`})]},o)})})}function lt(){return s("div",{className:"estimator-loading",children:[s("div",{className:"estimator-spinner"}),s("p",{children:"Loading..."})]})}function ct({message:e,onRetry:t}){return s("div",{className:"estimator-error",children:[s("div",{className:"estimator-error-icon",children:"!"}),s("p",{children:e||"Something went wrong"}),s("button",{className:"estimator-btn estimator-btn-secondary",onClick:t,children:"Try Again"})]})}function dt({services:e,selected:t,onSelect:o}){return s("div",{className:"estimator-step",children:[s("h3",{children:"Select a Service"}),s("div",{className:"estimator-services",children:e.map(r=>s("button",{className:`estimator-service-btn ${t===r.id?"selected":""}`,onClick:()=>o(r.id),children:r.name},r.id))})]})}function _t({fields:e,answers:t,jobAddress:o,jobPostcode:r,jobDescription:a,onFieldChange:i,onAddressChange:l,onPostcodeChange:d,onDescriptionChange:p,onBack:c,onNext:m,showBack:n}){const[h,u]=$({}),[y,S]=$({});function w(){const _=at(e,t);u(_);const x={};e.forEach(f=>{x[f.fieldId]=!0}),S(x),Object.keys(_).length===0&&m()}function b(_){S(f=>({...f,[_]:!0}));const x=e.find(f=>f.fieldId===_);if(x!=null&&x.required){const f=t[_];f==null||f===""||Array.isArray(f)&&f.length===0?u(N=>({...N,[_]:`${x.label} is required`})):u(N=>{const q={...N};return delete q[_],q})}}function g(_,x,f){const N=t[_]||[],q=f?[...N,x]:N.filter(D=>D!==x);i(_,q)}return s("div",{className:"estimator-step",children:[s("h3",{children:"Job Details"}),s("div",{className:"estimator-field",children:[s("label",{children:"Address"}),s("input",{type:"text",value:o,onChange:_=>l(_.target.value),placeholder:"123 Main Street"})]}),s("div",{className:"estimator-field",children:[s("label",{children:"Postcode / ZIP"}),s("input",{type:"text",value:r,onChange:_=>d(_.target.value),placeholder:"SW1A 1AA"})]}),s("div",{className:"estimator-field",children:[s("label",{children:"Project Description"}),s("textarea",{value:a,onChange:_=>p(_.target.value),placeholder:"Describe your project requirements, what you need done, any specific details...",rows:4}),s("small",{className:"estimator-help",children:"The more details you provide, the more accurate your quote will be."})]}),e.map(_=>{const x=y[_.fieldId]&&h[_.fieldId];return s("div",{className:`estimator-field ${x?"has-error":""}`,children:[s("label",{children:[_.label,_.required&&s("span",{className:"estimator-required",children:"*"})]}),_.type==="text"&&s("input",{type:"text",value:t[_.fieldId]||"",onChange:f=>i(_.fieldId,f.target.value),onBlur:()=>b(_.fieldId),placeholder:_.placeholder,className:x?"error":""}),_.type==="textarea"&&s("textarea",{value:t[_.fieldId]||"",onChange:f=>i(_.fieldId,f.target.value),onBlur:()=>b(_.fieldId),placeholder:_.placeholder,rows:3,className:x?"error":""}),_.type==="number"&&s("input",{type:"number",value:t[_.fieldId]??"",onChange:f=>{const N=f.target.value;i(_.fieldId,N?Number(N):"")},onBlur:()=>b(_.fieldId),placeholder:_.placeholder,className:x?"error":""}),_.type==="select"&&_.options&&s("select",{value:t[_.fieldId]||"",onChange:f=>i(_.fieldId,f.target.value),onBlur:()=>b(_.fieldId),className:x?"error":"",children:[s("option",{value:"",children:"Select..."}),_.options.map(f=>s("option",{value:f.value,children:f.label},f.value))]}),_.type==="radio"&&_.options&&s("div",{className:"estimator-radio-group",children:_.options.map(f=>s("label",{className:"estimator-radio",children:[s("input",{type:"radio",name:_.fieldId,value:f.value,checked:t[_.fieldId]===f.value,onChange:N=>i(_.fieldId,N.target.value)}),s("span",{children:f.label})]},f.value))}),_.type==="checkbox"&&_.options&&s("div",{className:"estimator-checkbox-group",children:_.options.map(f=>{const N=t[_.fieldId]||[];return s("label",{className:"estimator-checkbox",children:[s("input",{type:"checkbox",checked:N.includes(f.value),onChange:q=>g(_.fieldId,f.value,q.target.checked)}),s("span",{children:f.label})]},f.value)})}),_.type==="boolean"&&s("label",{className:"estimator-checkbox",children:[s("input",{type:"checkbox",checked:t[_.fieldId]||!1,onChange:f=>i(_.fieldId,f.target.checked)}),s("span",{children:_.helpText||"Yes"})]}),_.helpText&&_.type!=="boolean"&&s("small",{className:"estimator-help",children:_.helpText}),x&&s("small",{className:"estimator-field-error",children:h[_.fieldId]})]},_.fieldId)}),s("div",{className:"estimator-actions",children:[n&&s("button",{className:"estimator-btn estimator-btn-secondary",onClick:c,children:"Back"}),s("button",{className:"estimator-btn estimator-btn-primary",onClick:w,children:"Continue"})]})]})}function ut({name:e,email:t,phone:o,onNameChange:r,onEmailChange:a,onPhoneChange:i,onBack:l,onSubmit:d}){const p=e.trim()&&t.trim()&&t.includes("@");return s("div",{className:"estimator-step",children:[s("h3",{children:"Your Contact Details"}),s("div",{className:"estimator-field",children:[s("label",{children:["Name ",s("span",{className:"estimator-required",children:"*"})]}),s("input",{type:"text",value:e,onChange:c=>r(c.target.value),placeholder:"John Smith"})]}),s("div",{className:"estimator-field",children:[s("label",{children:["Email ",s("span",{className:"estimator-required",children:"*"})]}),s("input",{type:"email",value:t,onChange:c=>a(c.target.value),placeholder:"john@example.com"})]}),s("div",{className:"estimator-field",children:[s("label",{children:"Phone (optional)"}),s("input",{type:"tel",value:o,onChange:c=>i(c.target.value),placeholder:"+44 7700 900000"})]}),s("div",{className:"estimator-actions",children:[s("button",{className:"estimator-btn estimator-btn-secondary",onClick:l,children:"Back"}),s("button",{className:"estimator-btn estimator-btn-primary",onClick:d,disabled:!p,children:"Get Quote"})]})]})}function pt(){return s("div",{className:"estimator-loading",children:[s("div",{className:"estimator-spinner"}),s("p",{children:"Submitting your request..."})]})}function ft({quoteUrl:e,onClose:t,inline:o}){return s("div",{className:"estimator-success",children:[s("div",{className:"estimator-success-icon",children:"✓"}),s("h3",{children:"Request Submitted!"}),s("p",{children:"We're preparing your quote. You'll receive it shortly."}),s("a",{href:e,className:"estimator-btn estimator-btn-primary",target:"_blank",rel:"noopener",children:"View Your Quote"}),!o&&s("button",{className:"estimator-btn estimator-btn-secondary",onClick:t,children:"Close"})]})}function mt({onClick:e,label:t,position:o}){const r={"bottom-right":"estimator-fab-br","bottom-left":"estimator-fab-bl","top-right":"estimator-fab-tr","top-left":"estimator-fab-tl"};return s("button",{className:`estimator-fab ${r[o]||r["bottom-right"]}`,onClick:e,"aria-label":t,children:[s("span",{className:"estimator-fab-icon",children:"💬"}),s("span",{className:"estimator-fab-label",children:t})]})}const ht=`
/* Reset and base */
.estimator-widget,
.estimator-widget * {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
}

/* Widget container */
.estimator-widget {
  background: #ffffff;
  color: #1a1a1a;
  font-size: 14px;
  line-height: 1.5;
  width: 100%;
  max-width: 400px;
}

.estimator-widget-inline {
  border: 1px solid #e5e5e5;
  border-radius: 8px;
  overflow: hidden;
}

/* Header */
.estimator-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid #e5e5e5;
  background: #f9fafb;
}

.estimator-header h2 {
  font-size: 16px;
  font-weight: 600;
  color: #1a1a1a;
}

.estimator-close {
  background: none;
  border: none;
  font-size: 24px;
  color: #6b7280;
  cursor: pointer;
  padding: 0;
  line-height: 1;
}

.estimator-close:hover {
  color: #1a1a1a;
}

/* Body */
.estimator-body {
  padding: 20px;
}

/* Steps */
.estimator-step h3 {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 16px;
  color: #1a1a1a;
}

/* Services */
.estimator-services {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.estimator-service-btn {
  display: block;
  width: 100%;
  padding: 12px 16px;
  text-align: left;
  background: #ffffff;
  border: 1px solid #e5e5e5;
  border-radius: 6px;
  font-size: 14px;
  color: #1a1a1a;
  cursor: pointer;
  transition: all 0.15s ease;
}

.estimator-service-btn:hover {
  background: #f9fafb;
  border-color: #d1d5db;
}

.estimator-service-btn.selected {
  background: #eff6ff;
  border-color: #3b82f6;
  color: #1e40af;
}

/* Form fields */
.estimator-field {
  margin-bottom: 16px;
}

.estimator-field label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: #374151;
  margin-bottom: 6px;
}

.estimator-field input[type="text"],
.estimator-field input[type="email"],
.estimator-field input[type="tel"],
.estimator-field input[type="number"],
.estimator-field select,
.estimator-field textarea {
  display: block;
  width: 100%;
  padding: 10px 12px;
  font-size: 14px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: #ffffff;
  color: #1a1a1a;
  transition: border-color 0.15s ease;
}

.estimator-field input:focus,
.estimator-field select:focus,
.estimator-field textarea:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.estimator-field input::placeholder {
  color: #9ca3af;
}

.estimator-required {
  color: #ef4444;
  margin-left: 2px;
}

.estimator-help {
  display: block;
  font-size: 12px;
  color: #6b7280;
  margin-top: 4px;
}

/* Textarea */
.estimator-field textarea {
  resize: vertical;
  min-height: 80px;
}

/* Radio group */
.estimator-radio-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.estimator-radio {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.estimator-radio input[type="radio"] {
  width: 18px;
  height: 18px;
  cursor: pointer;
}

.estimator-radio span {
  font-size: 14px;
  color: #374151;
}

/* Checkbox group */
.estimator-checkbox-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* Checkbox */
.estimator-checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.estimator-checkbox input[type="checkbox"] {
  width: 18px;
  height: 18px;
  cursor: pointer;
}

.estimator-checkbox span {
  font-size: 14px;
  color: #374151;
}

/* Field validation errors */
.estimator-field.has-error input,
.estimator-field.has-error select,
.estimator-field.has-error textarea,
.estimator-field input.error,
.estimator-field select.error,
.estimator-field textarea.error {
  border-color: #ef4444;
}

.estimator-field.has-error input:focus,
.estimator-field.has-error select:focus,
.estimator-field.has-error textarea:focus,
.estimator-field input.error:focus,
.estimator-field select.error:focus,
.estimator-field textarea.error:focus {
  box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.1);
}

.estimator-field-error {
  display: block;
  font-size: 12px;
  color: #ef4444;
  margin-top: 4px;
}

/* Progress indicator */
.estimator-progress {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  margin-bottom: 20px;
  padding: 0 10px;
}

.estimator-progress-item {
  display: flex;
  align-items: center;
  flex: 1;
}

.estimator-progress-item:last-child {
  flex: 0;
}

.estimator-progress-circle {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  background: #e5e7eb;
  color: #6b7280;
  flex-shrink: 0;
}

.estimator-progress-circle.active {
  background: #3b82f6;
  color: #ffffff;
}

.estimator-progress-circle.completed {
  background: #3b82f6;
  color: #ffffff;
}

.estimator-progress-label {
  display: block;
  font-size: 11px;
  color: #6b7280;
  margin-top: 4px;
  text-align: center;
  position: absolute;
  width: 60px;
  left: 50%;
  transform: translateX(-50%);
  top: 32px;
}

.estimator-progress-label.active {
  color: #3b82f6;
  font-weight: 500;
}

.estimator-progress-item {
  position: relative;
  flex-direction: column;
  align-items: center;
}

.estimator-progress-line {
  height: 2px;
  background: #e5e7eb;
  flex: 1;
  margin: 0 8px;
  margin-top: 13px;
  position: absolute;
  left: 36px;
  right: -8px;
  top: 0;
}

.estimator-progress-line.completed {
  background: #3b82f6;
}

/* Buttons */
.estimator-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 10px 20px;
  font-size: 14px;
  font-weight: 500;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
  text-decoration: none;
}

.estimator-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.estimator-btn-primary {
  background: #3b82f6;
  color: #ffffff;
  border: none;
}

.estimator-btn-primary:hover:not(:disabled) {
  background: #2563eb;
}

.estimator-btn-secondary {
  background: #ffffff;
  color: #374151;
  border: 1px solid #d1d5db;
}

.estimator-btn-secondary:hover:not(:disabled) {
  background: #f9fafb;
}

.estimator-actions {
  display: flex;
  gap: 12px;
  margin-top: 20px;
}

.estimator-actions .estimator-btn-primary {
  flex: 1;
}

/* Loading state */
.estimator-loading {
  text-align: center;
  padding: 40px 20px;
}

.estimator-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid #e5e5e5;
  border-top-color: #3b82f6;
  border-radius: 50%;
  animation: estimator-spin 0.8s linear infinite;
  margin: 0 auto 16px;
}

@keyframes estimator-spin {
  to {
    transform: rotate(360deg);
  }
}

.estimator-loading p {
  color: #6b7280;
  font-size: 14px;
}

/* Error state */
.estimator-error {
  text-align: center;
  padding: 40px 20px;
}

.estimator-error-icon {
  width: 48px;
  height: 48px;
  background: #fef2f2;
  color: #ef4444;
  font-size: 24px;
  font-weight: 700;
  line-height: 48px;
  border-radius: 50%;
  margin: 0 auto 16px;
  border: 2px solid #fecaca;
}

.estimator-error p {
  color: #6b7280;
  margin-bottom: 16px;
}

/* Success state */
.estimator-success {
  text-align: center;
  padding: 40px 20px;
}

.estimator-success-icon {
  width: 64px;
  height: 64px;
  background: #10b981;
  color: #ffffff;
  font-size: 32px;
  line-height: 64px;
  border-radius: 50%;
  margin: 0 auto 16px;
}

.estimator-success h3 {
  font-size: 18px;
  margin-bottom: 8px;
}

.estimator-success p {
  color: #6b7280;
  margin-bottom: 20px;
}

.estimator-success .estimator-btn {
  display: block;
  width: 100%;
  margin-bottom: 8px;
}

/* Modal overlay */
.estimator-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  z-index: 999999;
}

.estimator-modal-content {
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
  max-height: 90vh;
  overflow-y: auto;
  animation: estimator-modal-in 0.2s ease;
}

@keyframes estimator-modal-in {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

/* Floating action button */
.estimator-fab {
  position: fixed;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 20px;
  background: #3b82f6;
  color: #ffffff;
  border: none;
  border-radius: 50px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  transition: all 0.2s ease;
  z-index: 999998;
}

.estimator-fab:hover {
  background: #2563eb;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2);
  transform: translateY(-2px);
}

.estimator-fab-icon {
  font-size: 18px;
}

.estimator-fab-br {
  bottom: 20px;
  right: 20px;
}

.estimator-fab-bl {
  bottom: 20px;
  left: 20px;
}

.estimator-fab-tr {
  top: 20px;
  right: 20px;
}

.estimator-fab-tl {
  top: 20px;
  left: 20px;
}

/* Mobile responsive */
@media (max-width: 480px) {
  .estimator-widget {
    max-width: 100%;
  }

  .estimator-modal-overlay {
    padding: 0;
    align-items: flex-end;
  }

  .estimator-modal-content {
    width: 100%;
    max-height: 95vh;
    border-radius: 12px 12px 0 0;
    animation: estimator-modal-in-mobile 0.3s ease;
  }

  @keyframes estimator-modal-in-mobile {
    from {
      opacity: 0;
      transform: translateY(100%);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .estimator-fab-label {
    display: none;
  }

  .estimator-fab {
    padding: 16px;
    border-radius: 50%;
  }
}
`;let je=!1;function bt(){if(je)return;const e=document.createElement("style");e.id="estimator-widget-styles",e.textContent=ht,document.head.appendChild(e),je=!0}let Z=!1,U=null,I=null;function Le(e){if(I=e,!I.tenantKey){console.error("[Estimator] tenantKey is required");return}bt(),(I.mode||"floating")==="inline"?gt():vt()}function gt(){if(!I)return;const e=I.container||"#estimator-widget",t=document.querySelector(e);if(!t){console.error(`[Estimator] Container not found: ${e}`);return}se(s(He,{tenantKey:I.tenantKey,serviceId:I.serviceId,apiUrl:I.apiUrl,onClose:()=>{},inline:!0}),t)}function vt(){if(!I)return;const e=document.createElement("div");e.id="estimator-floating-button",document.body.appendChild(e),se(s(mt,{onClick:Me,label:I.buttonLabel||"Get Quote",position:I.buttonPosition||"bottom-right"}),e),U=document.createElement("div"),U.id="estimator-modal",U.style.display="none",document.body.appendChild(U)}function Me(){!I||!U||Z||(Z=!0,U.style.display="block",se(s("div",{className:"estimator-modal-overlay",onClick:xt,children:s("div",{className:"estimator-modal-content",onClick:e=>e.stopPropagation(),children:s(He,{tenantKey:I.tenantKey,serviceId:I.serviceId,apiUrl:I.apiUrl,onClose:_e,inline:!1})})}),U),document.body.style.overflow="hidden")}function _e(){!U||!Z||(Z=!1,U.style.display="none",document.body.style.overflow="")}function xt(e){e.target.classList.contains("estimator-modal-overlay")&&_e()}window.EstimatorWidget={init:Le,open:Me,close:_e};function Be(){const e=document.currentScript;if(!e){const t=document.querySelectorAll("script[data-tenant-key]");if(t.length===0)return;We(t[t.length-1]);return}We(e)}function We(e){const t=e.dataset.tenantKey;t&&Le({tenantKey:t,mode:e.dataset.mode||"floating",container:e.dataset.container,serviceId:e.dataset.serviceId,buttonLabel:e.dataset.buttonLabel,buttonPosition:e.dataset.buttonPosition,apiUrl:e.dataset.apiUrl})}document.readyState==="loading"?document.addEventListener("DOMContentLoaded",Be):Be()})();
