// Demo boot (runs before the app bundle): point the app at the in-browser hub, make sure the demo service
// worker controls this page, then load the app. build-demo.mjs fills in the base path and the bundle URL.
;(function () {
  var BASE = '__MOJITO_DEMO_BASE__'
  var APP = '__MOJITO_DEMO_APP__'
  window.localStorage.setItem('mojito.hubUrl', window.location.origin + BASE + '/hub')
  window.localStorage.setItem('mojito.token', 'demo')

  function loadApp() {
    var s = document.createElement('script')
    s.src = APP
    document.body.appendChild(s)
    var tag = document.createElement('div')
    tag.id = 'mojito-demo-tag'
    tag.textContent = 'Demo · sample data · resets on reload'
    document.body.appendChild(tag)
  }

  var sw = navigator.serviceWorker
  sw.register(BASE + '/demo-sw.js', { scope: BASE + '/' })
  sw.ready.then(function (reg) {
    if (sw.controller !== null) return loadApp()
    sw.addEventListener('controllerchange', loadApp, { once: true })
    reg.active.postMessage('claim')
  })
})()
