import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * The rules of the CNG cylinders, in plain words: how often they are
 * requalified, which date counts, their end of life and what to keep.
 * Reading matter: a topic of the Cars guide, out of the car's CNG card.
 */
@Component({
  selector: 'cars-cng-guide',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <details open>
      <summary>What the requalification is</summary>
      <p>
        A car that runs on methane carries its gas in high-pressure cylinders
        (bombole). Each cylinder has to be checked again at fixed intervals by a
        workshop recognised by the Fondo Bombole Metano: the "revisione delle
        bombole", or requalification. It is a check of its own, apart from the
        car's revisione at the Motorizzazione or a centro revisioni.
      </p>
    </details>
    <details>
      <summary>How often</summary>
      <table>
        <thead>
          <tr>
            <th scope="col">Cylinders</th>
            <th scope="col">Requalified</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>UNECE R110, CNG-1, CNG-2, CNG-3</td>
            <td>Every 4 years; the first check is visual</td>
          </tr>
          <tr>
            <td>UNECE R110, CNG-4 (all-composite) on cars</td>
            <td>
              Every 4 years, unless the maker says otherwise (every 2 before
              July 2022)
            </td>
          </tr>
          <tr>
            <td>National approval (DGM), older cars</td>
            <td>Every 5 years</td>
          </tr>
        </tbody>
      </table>
      <p>
        The 4 years come from the decree of 13 May 2022 n. 144 (art. 2), in
        force since 14 July 2022; it keeps the earlier rules for everything it
        does not change. Most cars built or converted since the 2000s have R110
        cylinders: the label says "ECE R110".
      </p>
    </details>
    <details>
      <summary>Which date counts</summary>
      <p>
        The workshop applies a label (cartellino) on the car, usually in the
        engine bay, with each cylinder's litres, maker, serial number and the
        month it is due again (scadenza). That month is the deadline: the
        cylinders have to be requalified by its last day.
      </p>
      <ul>
        <li>
          Life Island takes the earliest month printed on the latest label.
        </li>
        <li>
          A label without a month: 4 years after it was applied (5 for national
          cylinders).
        </li>
        <li>
          No label on file: an estimate, 4 years after the car's first
          registration, until you load the label.
        </li>
      </ul>
      <p>
        When the serial numbers change from one label to the next, your
        cylinders were exchanged for requalified ones, as the Fondo's workshops
        often do: the card marks it.
      </p>
    </details>
    <details>
      <summary>End of life</summary>
      <p>
        An R110 cylinder lasts as long as its maker says (a "do not use after"
        date on the cylinder), never more than 20 years: then it is replaced,
        not checked again. If the label or the cylinder prints that date, add it
        and Life Island warns for it too.
      </p>
    </details>
    <details>
      <summary>In the car or at home?</summary>
      <p>
        Nothing to carry. The label stays fixed on the car, and the law (art.
        180 Codice della strada) asks you to have on board only the carta di
        circolazione, your licence and the insurance certificate. Keep a copy of
        the latest label at home: it lists your cylinders and when they are due.
        Older labels can go.
      </p>
    </details>
    <details>
      <summary>Past the date</summary>
      <p>
        With expired cylinders the car may not be driven, not even on petrol:
        the cylinders stay part of the car. Replacing cylinders at the end of
        their life or after a failed check is paid by the Fondo Bombole Metano
        (decree of 12 March 2026 n. 98); the workshop may charge its labour.
      </p>
    </details>
    <p class="ui-info-sources">
      Check with your workshop for your car. Sources:
      <a
        href="https://www.metanospilamberto.it/revisione-bombole-r110-ogni-4-anni/"
        target="_blank"
        rel="noopener"
        >DM 144/2022, art. 2</a
      >
      ·
      <a
        href="https://www.sicurauto.it/news/codice-della-strada/revisione-bombole-metano-cosa-prevede-il-nuovo-decreto-13-5-2022/"
        target="_blank"
        rel="noopener"
        >SicurAUTO on the decree</a
      >
      ·
      <a
        href="https://www.primauto.it/revisione-bombole-metano-come-fare-e-quanto-costa/"
        target="_blank"
        rel="noopener"
        >Primauto, 2026</a
      >
      ·
      <a
        href="https://www.missionline.it/mission-fleet-post/revisione-bombole-auto-gpl-e-metano/"
        target="_blank"
        rel="noopener"
        >Missionline, 2026</a
      >
    </p>
  `,
})
export class CngGuideTopic {}
