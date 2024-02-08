import { Component, ElementRef, HostListener, Input, ViewChild } from '@angular/core';
import { Range } from 'src/app/lib/range';
import { AudioTrack, DashTech, HlsTech, Player, Quality, TechInterface } from 'nas-player';
import { StateControllerService } from '../services/state-controller.service';
import { Header } from '../models/header';
import { Logger } from 'nas-logger';
import { NotificationService } from '../services/notification.service';

@Component({
  selector: 'app-player-controls',
  templateUrl: './player-controls.component.html',
  styleUrls: ['./player-controls.component.css']
})
export class PlayerControlsComponent {
  @Input() parent!: HTMLDivElement;
  @Input() videoElement!: HTMLVideoElement;

  @ViewChild('settings') settings!: ElementRef;
  @ViewChild('progress') progress!: ElementRef;
  @ViewChild('volume') volume!: ElementRef;
  
  player!: Player;
  tech!: TechInterface;
  progressBar!: Range;
  volumeBar!: Range;
  seekLock: boolean = false;
  currentTime: string = '00:00:00';
  duration: string = '00:00:00';
  fullscreen: boolean = false;
  icon: string = 'play_arrow';
  volumeIcon: string = 'volume_mute';
  premuteVolume: number = 0;

  selectedAudioTrack: AudioTrack = {
    lang: 'Default',
    name: 'Default',
    index: 0
  }

  selectedQuality: Quality = {
    index: 0,
    bitrate: 0,
    bitrateStr: '0k',
    width: 0,
    height: 0
  }

  currentAutoQuality: Quality = {
    index: 0,
    bitrate: 0,
    bitrateStr: '0k',
    width: 0,
    height: 0
  }

  streamingUrl!: string;
  licenseUrl!: string;
  subtitleUrl!: string;
  streamingUrlHeaders: any = {};
  licenseUrlHeaders: any = {};

  qualities: Quality[] = [ {
    index: 0,
    bitrate: 0,
    bitrateStr: '0k',
    width: 0,
    height: 0
  } ];

  audioTracks: AudioTrack[] = [ this.selectedAudioTrack ]
  logger: Logger = new Logger('PlayerControlsComponent');

  constructor(
    public stateControllerService: StateControllerService,
    private notificationService: NotificationService
  ) {

    
    stateControllerService.setDebug(false);

    stateControllerService.registerTransitions('player-muted', [
      { from: 'unmuted', to: 'muted', handle: () => {
        this.volumeIcon = 'volume_off';
        this.player.setVolume(0);
      }},
      { from: 'muted', to: 'unmuted', handle: () => {
        this.setVolume(this.premuteVolume);
      }}
    ], 'unmuted');

    stateControllerService.registerTransitions('settings', [
      {
        from: 'collapsed', to: 'visible', object: this, handle: null
      },
      {
        from: 'visible', to: 'collapsed', object: this, handle: null
      }
    ], 'collapsed');

    stateControllerService.registerTransitions('controls', [
      {
        from: 'collapsed', to: 'visible', object: this, handle: () => {
            document.body.style.cursor = 'initial';
        }
      },
      {
        from: 'visible', to: 'collapsed', object: this, delay: 2500, handle: () => {
          document.body.style.cursor = 'none';
        }
      }
    ], 'collapsed');
  }

  ngOnInit() {
    this.player = new Player();
  }

  ngAfterViewInit(): void {
    this.resizeProgressBar();

    this.progressBar = new Range(this.progress.nativeElement, (value: number) => {
      if(isNaN(value)) {
        return;
      }

      this.player.seek(value);
    }, 0, this.player.getDuration(), 0, 'horizontal', 'controls-item controls-padding');

    this.volumeBar = new Range(this.volume.nativeElement, (value: number) => {
      if(isNaN(value)) {
        return;
      }

      this.premuteVolume = value / 100;
      this.setVolume(value / 100);
    }, 0, 99, 99, 'horizontal', 'controls-item controls-padding');

    window.addEventListener('mousemove', (e: any) => {
      this.displayControls();
    }, false);

    var elems = document.querySelectorAll('.controls-item');

    for(let i = 0; i < elems.length; i++) {
      elems[i].addEventListener('click', this.animateControlItem.bind(elems[i]));
    } 
  }

  animateControlItem(e: any) {
    e.target.style.background = 'click_animation .250s';
  }

  loadStream() {
    if(!this.streamingUrl) {
      this.notificationService.show('Player Error', 'Please enter streaming URL');
      this.stateControllerService.transition('settings', 'visible');
      this.stateControllerService.transition('loader', 'collapsed');
      return;
    }

    this.stateControllerService.transition('settings', 'collapsed');
    this.player.destroy();
    this.player = new Player();

    this.guessTech(this.streamingUrl);
    this.attachPlayerEventHandlers();

    let licenseUrlHeaders = null;
    let streamingUrlHeaders = null;

    if(Object.keys(this.streamingUrlHeaders).length != 0) {
      streamingUrlHeaders = this.streamingUrlHeaders;
    }

    if(Object.keys(this.licenseUrlHeaders).length != 0) {
      licenseUrlHeaders = this.licenseUrlHeaders;
    }

    this.player.init(
      this.tech,
      this.videoElement,
      this.streamingUrl,
      true,
      false,
      streamingUrlHeaders,
      {
          "com.widevine.alpha": {
              "serverURL": this.licenseUrl,
              "httpRequestHeaders": licenseUrlHeaders
          }
      },
      (e: any) => {
        this.notificationService.show("Player Error", "Please enter license URL");
        this.stateControllerService.transition('settings', 'visible');
        this.stateControllerService.transition('loader', 'collapsed');
      }
    );

    if(this.subtitleUrl) {
      this.player.loadSubtitles(this.subtitleUrl);
    }
  }

  loadSubtitle(subtitleUrl: string) {
    this.player.loadSubtitles(subtitleUrl);
  }

  displayControls() {
    this.stateControllerService.transition('controls', 'visible');
    this.stateControllerService.transition('controls', 'collapsed');
  }

  freezeControls = () => {
    this.stateControllerService.lock('controls', 'visible');
  }

  unfreezeControls = () => {
    this.stateControllerService.unlock('controls');
    this.stateControllerService.transition('controls', 'collapsed');
  }

  playPause() {
    if(this.player.videoElement.paused) {
      this.icon = 'pause';
      this.player.play();
    } else {
      this.icon = 'play_arrow';
      this.player.pause();
    }
  }

  subtitleDelay(e: any) {
    var delay = e.target.value;

    if(delay && this.player.getSubtitlesUrl() && '' != this.player.getSubtitlesUrl()) {
      this.player.loadSubtitles(this.player.getSubtitlesUrl() + '&delay=' + delay);
    }
  }

  selectAudioTrack(e: any) {
    this.selectedAudioTrack = e;
    this.player.setAudioTrack(e.index);
  }

  selectQuality(e: any) {
    this.selectedQuality = e;
    this.player.setQuality(e.index);
  }

  selectSpeed(e: any) {
    if(e < 0) {
      this.notificationService.show('Playback rate', 'Playback rate cannot be negative');
      return;
    }

    this.player.setPlaybackRate(e);
  }

  toggleFullscreen() {
    if(!this.fullscreen) {
      this.parent.requestFullscreen();
      this.fullscreen = true;
    } else {
      document.exitFullscreen();
      this.fullscreen = false;
    }
  }

  toggleSettings() {
    if('visible' == this.stateControllerService.getState('settings')) {
      this.stateControllerService.transition('settings', 'collapsed');
    } else {
      this.stateControllerService.transition('settings', 'visible');
    }
  }

  guessTech(url: string) {
    if('undefined' === typeof(url)) {
        this.logger.e('URL is undefined');
        return;
    }
    
    if(url.indexOf('.mpd') > -1) {
        this.logger.d("Selecting DASH tech...");
        this.tech = new DashTech();
    } else if(url.indexOf('.m3u8') > -1) {
      this.logger.d("Selecting HLS tech...");
        this.tech = new HlsTech();
    }

    if(null == this.tech) {
        throw 'Url ' + url + ' not recognized.';
    }
  }

  attachPlayerEventHandlers() {
    this.player.addEventHandler('play', (e: any) => {
      this.premuteVolume = this.volumeBar.value / 100;
      this.setVolume(this.volumeBar.value / 100);
    });

    this.player.addEventHandler('playing', (e: any) => {
      this.logger.d('play');
      this.stateControllerService.transition('loader', 'collapsed');
      this.icon = 'pause';

      this.audioTracks = this.player.getAudioTracks();
      this.selectedAudioTrack = this.audioTracks[0];
      this.qualities = this.player.getQualities();
      
      this.updateCurrentAutoQuality().then(() => {
        this.selectedQuality = this.qualities[0];
      });

      this.duration = this.formatTimeFromSeconds(this.player.getDuration());
    });

    this.player.addEventHandler('seeking', () => {
      this.logger.d('seeking');
      this.stateControllerService.transition('loader', 'visible');
    });

    this.player.addEventHandler('waiting', () => {
      this.logger.d('waiting');
      this.stateControllerService.transition('loader', 'visible');
    });

    this.player.addEventHandler('error', (e:any) => {
      this.logger.e(e);
      this.notificationService.show('Player error', e.message);
      this.stateControllerService.transition('settings', 'visible');
    });

    this.player.addEventHandler('hlsError', (e:any) => {
      this.logger.e(e.details);
      this.notificationService.show('Player error', e.details);
      this.stateControllerService.transition('settings', 'visible');
    });

    this.player.addEventHandler('streamInitialized', () => {

    });

    this.player.addEventHandler('timeupdate', () => {
      this.currentTime = this.formatTimeFromSeconds(this.player.getCurrentTime());

      if(this.progressBar) {
        this.progressBar.setMaxValue(this.player.getDuration());
      }

      if(this.player.getCurrentTime) {
        this.progressBar.setValue(this.player.getCurrentTime());
      }

      this.updateCurrentAutoQuality();
    });
  }

  async updateCurrentAutoQuality() {
    var currentQuality = this.player.getCurrentQuality();
      
    for(var q in this.qualities) {
      if(this.qualities[q].index == currentQuality.index) {
        this.currentAutoQuality = this.qualities[q];
        return;
      }
    }
  }

  formatTimeFromSeconds(val: number) {
    var hours = Math.floor(val / 3600);

    var minutes = Math.floor(val / 60);
    minutes = minutes < 60 ? minutes :  (Math.floor(val / 60) - hours * 60);

    var seconds = val < 60 ? val : val - ((hours * 3600) + (minutes * 60));
    seconds = Math.floor(seconds);

    return hours.toString().padStart(2, '0') + ':' + minutes.toString().padStart(2, '0') + ':' + seconds.toString().padStart(2, '0');
  }

  resizeProgressBar() {
    this.progress.nativeElement.style.width = (window.innerWidth - 445) + 'px';
  }

  @HostListener('window:resize', ['$event'])
  onResize(event:any) {
      this.resizeProgressBar();
  }

  changeStreamingUrl(streamingUrl: string) {
    this.streamingUrl = streamingUrl;
  }

  changeLicenseUrl(licenseUrl: string) {
    this.licenseUrl = licenseUrl;
  }

  changeStreamingUrlHeaders(streamingUrlHeaders: Array<Header>) {
    this.streamingUrlHeaders = {};

    for(let i = 0; i < streamingUrlHeaders.length; i++) {
      if('' != streamingUrlHeaders[i].name && '' != streamingUrlHeaders[i].value) {
        this.streamingUrlHeaders[streamingUrlHeaders[i].name] = streamingUrlHeaders[i].value;
      }
    }
  }

  changeLicenseUrlHeaders(licenseUrlHeaders: Array<Header>) {
    console.log(licenseUrlHeaders);
    this.licenseUrlHeaders = {};

    for(let i = 0; i < licenseUrlHeaders.length; i++) {
      if('' != licenseUrlHeaders[i].name && '' != licenseUrlHeaders[i].value) {
        this.licenseUrlHeaders[licenseUrlHeaders[i].name] = licenseUrlHeaders[i].value;
      }
    }
  }

  toggleMute() {
    if('muted' == this.stateControllerService.getState('player-muted')) {
      this.stateControllerService.transition('player-muted', 'unmuted');
      return;
    }

    this.stateControllerService.transition('player-muted', 'muted');
  }

  setVolume(volume: number) {
    this.stateControllerService.setState('player-muted', 'unmuted');
    this.player.setVolume(volume);

    if(volume == 0) {
      this.volumeIcon = 'volume_mute';
    } else if(volume > 0 && volume <= .5) {
      this.volumeIcon = 'volume_down';
    } else if(volume > .5) {
      this.volumeIcon = 'volume_up';
    }
  }

  ngOnDestroy() {
    var elems = document.querySelectorAll('.controls-item');

    for(let i = 0; i < elems.length; i++) {
      elems[i].removeEventListener('click', this.animateControlItem);
    } 
  }
}