# Disponibilidade e disputa por horário

## Situação

A consulta deve diferenciar ocupação parcial, horários consecutivos e quadras fora de operação.

## Escolha na implementação

O módulo compartilhado exclui quadras inativas e intervalos sobrepostos. No servidor, a confirmação relaciona retenção, ocupação e reserva.

## Consequências

A disponibilidade exibida é uma consulta. A autorização para gravar e a disputa simultânea exigem o caminho do servidor e seus registros.

## Código

- [src/management-schedule-availability.ts](../../src/management-schedule-availability.ts)
- [src/management-local-time.ts](../../src/management-local-time.ts)
- [src/management-reservation-time.ts](../../src/management-reservation-time.ts)
- [reference/schedule-store.ts](../../reference/schedule-store.ts)
- [reference/reservation-service.ts](../../reference/reservation-service.ts)

## Verificação desta edição

Os testes verificam consulta, limites de intervalo e fuso. Não executam duas gravações concorrentes no MongoDB.
