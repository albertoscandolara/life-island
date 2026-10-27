import {
  ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  UiAlert,
  UiButton,
  UiDialog,
  UiIcon,
} from '@life-island/design-system';

/**
 * Takes a photo with the device camera (getUserMedia) and emits it as a JPEG
 * file. Prefers the rear camera on phones. If the camera is unavailable or
 * blocked, `unavailable` fires so the caller can fall back to the native
 * `capture` file input.
 */
@Component({
  selector: 'app-camera-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiAlert, UiButton, UiDialog, UiIcon],
  template: `
    <ui-dialog
      [(open)]="open"
      heading="Take a photo"
      size="lg"
      (closed)="stop()"
    >
      @if (error()) {
        <ui-alert tone="danger">{{ error() }}</ui-alert>
      }
      <video
        #video
        class="camera"
        autoplay
        playsinline
        muted
        [hidden]="!!error()"
      ></video>
      <div uiDialogFooter>
        <button
          uiButton
          variant="secondary"
          type="button"
          (click)="open.set(false)"
        >
          Cancel
        </button>
        <button
          uiButton
          type="button"
          [disabled]="!ready()"
          (click)="capture()"
        >
          <ui-icon name="camera" [size]="18" /> Capture
        </button>
      </div>
    </ui-dialog>
  `,
  styles: `
    .camera {
      display: block;
      width: 100%;
      max-height: 60vh;
      border-radius: var(--card-radius);
      background: var(--surface-sunken);
      object-fit: contain;
    }
  `,
})
export class CameraDialog {
  readonly open = model(false);
  readonly captured = output<File>();
  readonly unavailable = output<void>();

  protected readonly ready = signal(false);
  protected readonly error = signal('');
  private readonly video = viewChild<ElementRef<HTMLVideoElement>>('video');
  private stream?: MediaStream;

  constructor() {
    effect(() => {
      if (this.open()) void this.start();
    });
  }

  private async start(): Promise<void> {
    this.error.set('');
    this.ready.set(false);
    if (!navigator.mediaDevices?.getUserMedia) {
      this.open.set(false);
      this.unavailable.emit();
      return;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } },
        audio: false,
      });
      const video = this.video()?.nativeElement;
      if (!video || !this.open()) return this.stop();
      video.srcObject = this.stream;
      await video.play();
      this.ready.set(true);
    } catch (error) {
      const denied = (error as DOMException).name === 'NotAllowedError';
      this.error.set(
        denied
          ? 'Camera access was blocked. Allow it in the browser, or close this and pick a photo file.'
          : 'No camera found on this device.',
      );
    }
  }

  protected capture(): void {
    const video = this.video()?.nativeElement;
    if (!video?.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const stamp = new Date()
          .toISOString()
          .slice(0, 19)
          .replace(/[T:]/g, '-');
        this.captured.emit(
          new File([blob], `photo-${stamp}.jpg`, { type: 'image/jpeg' }),
        );
        this.open.set(false);
      },
      'image/jpeg',
      0.9,
    );
  }

  protected stop(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
    this.ready.set(false);
  }
}
