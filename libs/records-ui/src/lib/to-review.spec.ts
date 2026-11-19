import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DOCUMENTS_APP_URL } from '@life-island/settings-ui';
import { LiReviewItem, LiToReview, TO_REVIEW_ID } from './to-review';

@Component({
  imports: [LiReviewItem, LiToReview],
  template: `
    <li-to-review [count]="docs().length" what="car documents">
      <p intro>New car documents never change a car on their own.</p>
      @for (d of docs(); track d) {
        <li-review-item heading="Insurance" previewUrl="/file/1" [busy]="true">
          <span title class="plate">· AB123CD</span>
          <ng-container meta>{{ d }}</ng-container>
          <ng-container actions
            ><button type="button">Approve</button></ng-container
          >
          <p class="body">Which car?</p>
        </li-review-item>
      }
    </li-to-review>
  `,
})
class Host {
  readonly docs = signal<string[]>([]);
}

describe('LiToReview', () => {
  function render(docs: string[]) {
    TestBed.configureTestingModule({
      providers: [{ provide: DOCUMENTS_APP_URL, useValue: '/documents/' }],
    });
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.docs.set(docs);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('is the one place Review buttons open, and says how to load one when empty', () => {
    const el = render([]);
    const block = el.querySelector('li-to-review')!;
    expect(block.id).toBe(TO_REVIEW_ID);
    expect(block.textContent).toContain('Nothing to review');
    expect(block.textContent).toContain('Car documents you load');
    expect(
      el.querySelector('a[href="/documents/upload"]')?.textContent,
    ).toContain('Load a document');
  });

  it("shows each document with its file, the area's choices and its buttons", () => {
    const el = render(['Polizza.pdf']);
    expect(el.textContent).toContain('1 waiting');
    expect(el.textContent).not.toContain('Nothing to review');
    const item = el.querySelector('li-review-item')!;
    expect(item.classList).toContain('li-review--busy');
    expect(item.querySelector('h3')?.textContent).toContain('Insurance');
    expect(item.querySelector('h3 .plate')).not.toBeNull();
    expect(item.querySelector('header p')?.textContent).toContain(
      'Polizza.pdf',
    );
    expect(item.querySelector('a[href="/file/1"]')).not.toBeNull();
    expect(item.querySelector('.body')).not.toBeNull();
    expect(item.querySelector('footer button')?.textContent).toBe('Approve');
  });
});
