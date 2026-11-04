# Preço e origem da cobrança

## Situação

Uma resposta de preço ou cobrança pode chegar com valores inconsistentes ou com a identidade de outra operação.

## Escolha na implementação

O contrato conserva centavos inteiros e exige total = sinal + saldo. A prévia confere quadra, responsável e período; a cobrança conserva clube, reserva, origem e fatura.

## Consequências

O leitor recusa dados divergentes antes da apresentação. A efetivação de uma cobrança e sua conciliação pertencem a outros serviços.

## Código

- [src/management-reservation-quote.ts](../../src/management-reservation-quote.ts)
- [src/management-reservation-charge.ts](../../src/management-reservation-charge.ts)
- [src/management-reservation-charge-origin.ts](../../src/management-reservation-charge-origin.ts)

## Verificação desta edição

Nove cenários conferem valores, identidade, parâmetros duplicados e respostas de outra escolha. Não há cobrança real.
