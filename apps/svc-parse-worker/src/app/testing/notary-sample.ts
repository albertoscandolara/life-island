/**
 * The sample pair for invoice and payment matching: a notary's quote for a
 * first home and the bank transfer that paid it, three weeks apart.
 */

/** The text layer of the sample transfer PDF (a bank), as pdfText reads it. */
export const NOTARY_TRANSFER = `Pag. 1 / 1
Dettaglio Bonifico SEPA
DATI BONIFICO SEPA
Importi  in  EURO  (€)
Stato del bonifico
Eseguito
Canale di regolamento
Sepa
ID transazione (CRO)
A100000000000000000000000001IT
Divisa
EUR
Data di inserimento
14/07/2025
Data di addebito
15/07/2025
Paese di destinazione
ITALY
Saldo atto notarile prima casa in via Verdi 9 a Verona del 2 Luglio 2025 come da preventivo del
Causale
27 Giugno 2025
Importo
6.500,00
Commissioni
0,00
IMPORTO TOTALE
6.500,00
DATI ORDINANTE
Ordinante  ROSSI MARIO
IBAN
IT02A0300203280000000001234
Conto  0000/000000
Eseguito da  Mario Rossi
DATI BENEFICIARIO
Beneficiario
Notaio Bianchi Avvocato Paolo
IBAN
IT11B0760111700000000777888
Codice BIC
EXAMITMMXXX
Banca
ABI 08807 - BANCA DI ESEMPIO
Esito servizio di verifica del beneficiario
Verifica beneficiario non prevista prima del 09/10/2025
Data 06/02/26 Ora 19:15`;

/** The sample quote is a scan with no text layer; this is what it prints. */
export const NOTARY_QUOTE = `Notaio Bianchi Avv. Paolo
37100 Verona - Piazza Bra, 1
Tel. 045/0000000
Cod.Fisc. BNC PLA 51A22 F839G - Part. IVA 00999888777
Egr.
ROSSI MARIO
Via Roma 1
37100 - Verona (VR)
C.F.: RSSMRA80A01L781X
Preventivo N. 0
del 27/06/2025
Oggetto: Compravendita 218.000
TOTALI PARZIALI € 4.364,50 € 1.750,41
I.V.A. 22 % su € 1.750,41 € 385,09
TOTALE € 6.500,00
TOTALE DA PAGARE € 6.500,00
Il presente non costituisce documento fiscale
NOTAIO BIANCHI PAOLO
BANCA DI ESEMPIO - FILIALE DI VERONA
CONTO DEDICATO
IT 11 B 07601 11700 000000777888`;
