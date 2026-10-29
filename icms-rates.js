// Alíquotas padrão transcritas da diagonal da fonte indicada. Não são regras por NCM.
export const ICMS_REFERENCE=Object.freeze({
  "source": "https://www.calculadoraicms.com.br/",
  "sourceUpdatedAt": "2026-08-19",
  "retrievedAt": "2026-10-29"
});
export const INTERNAL_RATES=Object.freeze({
  "AC": 19,
  "AL": 20.5,
  "AP": 18,
  "AM": 20,
  "BA": 20.5,
  "CE": 20,
  "DF": 20,
  "ES": 17,
  "GO": 19,
  "MA": 23,
  "MT": 17,
  "MS": 17,
  "MG": 18,
  "PA": 19,
  "PB": 20,
  "PR": 19.5,
  "PE": 20.5,
  "PI": 22.5,
  "RJ": 22,
  "RN": 20,
  "RS": 17,
  "RO": 19.5,
  "RR": 20,
  "SC": 17,
  "SP": 18,
  "SE": 20,
  "TO": 20
});
export function destinationInternalRate(state){return Object.hasOwn(INTERNAL_RATES,state)?INTERNAL_RATES[state]:null;}
