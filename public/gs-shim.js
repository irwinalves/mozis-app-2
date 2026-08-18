/**
 * Reimplementa `google.script.run` sobre `fetch`.
 *
 * É a peça que permite servir o `Form.html` SEM UMA LINHA ALTERADA. O front
 * chama o backend em 15 pontos, todos no mesmo formato:
 *
 *     google.script.run
 *       .withSuccessHandler(cb)
 *       .withFailureHandler(cb)
 *       .nomeDoMetodo(arg1, arg2)
 *
 * Cada `with*` devolve um proxy NOVO, então chamadas simultâneas não misturam
 * handlers — o app dispara acerto, lista e dashboard juntos no boot.
 */
(function () {
  'use strict';

  function criarRunner(handlers) {
    return new Proxy(
      {},
      {
        get: function (_alvo, prop) {
          if (prop === 'withSuccessHandler') {
            return function (cb) {
              return criarRunner({ sucesso: cb, falha: handlers.falha });
            };
          }
          if (prop === 'withFailureHandler') {
            return function (cb) {
              return criarRunner({ sucesso: handlers.sucesso, falha: cb });
            };
          }
          if (typeof prop !== 'string') return undefined;

          // Qualquer outra propriedade é tratada como nome de método do backend.
          return function () {
            var args = Array.prototype.slice.call(arguments);
            fetch('/api/' + prop, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(args),
            })
              .then(function (r) {
                return r.json().then(function (corpo) {
                  if (!r.ok) throw new Error(corpo && corpo.error ? corpo.error : 'Erro no servidor');
                  return corpo;
                });
              })
              .then(function (valor) {
                if (handlers.sucesso) handlers.sucesso(valor);
              })
              .catch(function (e) {
                // O front trata erro em 14 das 15 chamadas. Onde não trata, ao
                // menos não morre em silêncio.
                if (handlers.falha) handlers.falha(e);
                else console.error('[gs-shim] ' + prop + ':', e);
              });
          };
        },
      },
    );
  }

  window.google = { script: { run: criarRunner({}) } };
})();
