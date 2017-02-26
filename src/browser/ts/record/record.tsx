import Component, { React, Reference, DataSnapshot } from '../component';
import { Link, browserHistory } from 'react-router';
import RecordIcon from 'react-icons/md/fiber-manual-record';
import StopIcon from 'react-icons/md/stop';
import ViewIcon from 'react-icons/md/pageview';

import Recorder from '../lib/recorder';

import * as styles from '../styles';
import Page from '../page';
import Container from '../container';
import Editor from '../editor';
import Button from '../button';
import RelativeTime from '../relativetime';

export interface RecordProps {
	params: {
		id?: string;
	};
}

export default class Record extends Component<RecordProps, {
	output?: string;
	name?: string;
	code?: string;
	recording?: boolean;
	done?: number;
	start?: number;
	recorder?;
	enabled?: boolean;
	stream?: MediaStream;
}> {
	
	code: ReactCodeMirror.ReactCodeMirror;
	
	replay: Reference;
	
	componentPropsChanged(nextProps: RecordProps) {
		if (!nextProps.params.id) {
			return this.generate().catch(this.catch);
		}
		this.replay = this.getReplay(nextProps.params.id);
		this.init().then(() => this.update()).catch(this.catch);
	}
	
	componentWillMount() {
		if (!this.uid) {
			return browserHistory.push('/');
		}
		if (!this.props.params.id) {
			return this.generate().catch(this.catch);
		}
		this.replay = this.getReplay(this.props.params.id);
		this.init().catch(this.catch);
	}
	
	async init() {
		const data = await this.replay.once('value') as DataSnapshot;
		const val = data.val() || {};
		await this.update({
			done: val.recording,
			name: val.name,
			code: val.initial ? val.initial.code : ''
		});
		if (val.initial) {
			this.code.getCodeMirror().getDoc().setHistory(JSON.parse(val.initial.history));
		}
		const stream = await this.getUserMedia();
		
		const audioContext = new AudioContext();
		const inputPoint = audioContext.createGain();
		
		const realAudioInput = audioContext.createMediaStreamSource(stream);
		const audioInput = realAudioInput;
		audioInput.connect(inputPoint);
		
		const analyzerNode = audioContext.createAnalyser();
		analyzerNode.fftSize = 2048;
		inputPoint.connect(analyzerNode);
		
		const audioRecorder = new Recorder(inputPoint);
		
		const zeroGain = audioContext.createGain();
		zeroGain.gain.value = 0;
		inputPoint.connect(zeroGain);
		zeroGain.connect(audioContext.destination);
		
		await this.update({
			recorder: audioRecorder,
			stream,
			enabled: true
		});
	}
	
	componentWillUnmount() {
		this.state.stream.getAudioTracks()[0].stop();
	}
	
	getUserMedia() {
		return new Promise<MediaStream>((resolve, reject) => window.navigator.getUserMedia({
				audio: {
					mandatory: {
							googEchoCancellation: 'false',
							googAutoGainControl: 'false',
							googNoiseSuppression: 'false',
							googHighpassFilter: 'false'
					},
					optional: []
				},
			} as any, resolve, reject));
	}
	
	async onName(e: React.ChangeEvent<HTMLInputElement>) {
		const name = e.target.value;
		await this.update({
			name
		});
		await this.set(this.getReplayName(this.replay), name);
	}
	
	async onCode(code: string) {
		const now = this.now;
		await this.update({
			code
		});
		const send = {
			code,
			history: JSON.stringify(this.code.getCodeMirror().getDoc().getHistory())
		};
		if (this.state.recording) {
			if (!this.state.start) {
				await this.update({
					start: now
				});
			}
			const offset = now - this.state.start;
			await this.set(this.getReplayCode(this.replay, offset), send);
			return;
		}
		await this.set(this.getReplayInitial(this.replay), send);
	}
	
	onCursorAttached = this.attach(this.onCursor);
	
	async onCursor(editor: CodeMirror.Editor) {
		const now = this.now;
		if (!this.state.recording) {
			return;
		}
		const doc = editor.getDoc();
		const anchor = doc.getCursor('anchor');
		const head = doc.getCursor('head');
		const send = {
			anchor: {
				line: anchor.line,
				ch: anchor.ch
			},
			head: {
				line: head.line,
				ch: head.ch
			}
		};
		if (!this.state.start) {
			await this.update({
				start: now
			});
		}
		await this.set(this.getReplaySelect(this.replay, now - this.state.start), JSON.stringify(send));
	}
	
	async generate() {
		browserHistory.push(this.getRecordUrl(this.pushRef(this.replays).key));
	}
	
	async onRecord() {
		await this.update({
			enabled: false
		});
		await this.set(this.getReplayUid(this.replay), this.uid);
		await this.set(this.getReplayInitial(this.replay), {
			code: this.state.code || '',
			history: JSON.stringify(this.code.getCodeMirror().getDoc().getHistory())
		})
		const now = this.now;
		this.state.recorder.clear();
		this.state.recorder.record();
		await Promise.all([this.update({
			recording: true,
			start: now
		}), this.set(this.getReplayRecording(this.replay), true)]);
		this.code.focus();
		await this.update({
			enabled: true
		});
	}
	
	getBuffers() {
		return new Promise<any>(resolve => this.state.recorder.getBuffers(resolve));
	}
	
	exportWAV() {
		return new Promise<Blob>(resolve => this.state.recorder.exportWAV(resolve));
	}
	
	blobToBase64(blob: Blob) {
		return new Promise<string>(resolve => {
			const reader = new FileReader();
			reader.onloadend = () => resolve(reader.result);
			reader.readAsDataURL(blob);
		});
	}
	
	async onStop() {
		await this.update({
			enabled: false
		});
		const now = this.now;
		this.state.recorder.stop();
		const blob = await this.exportWAV();
		
		const audio = await this.blobToBase64(blob);
		console.log(audio);
		
		await this.update({
			recording: false,
			done: now - this.state.start
		});
		browserHistory.push(this.getReplayUrl(this.props.params.id));
	}
	
	render() {
		return (
			<Page className="record" title="Record">
				<Container>
					<input placeholder="Recording Name" value={this.state.name || ''} onChange={this.attach(this.onName)} disabled={!!this.state.done}/>
				</Container>
				<Container>
					<div className="editor box">
						{this.state.recording ? 
							<Button disabled={!this.state.enabled} onClick={this.attach(this.onStop)}>
								<StopIcon size={styles.editorIconSize} color={styles.editorRecordColor}/>
							</Button> :
							this.state.done ? 
							<div>
								<Link to={this.getReplayUrl(this.props.params.id)}>
									<ViewIcon size={styles.editorIconSize}/>
								</Link>
							</div> :
							<Button disabled={!this.state.recorder || !this.state.enabled} onClick={this.attach(this.onRecord)}>
								<RecordIcon size={styles.editorIconSize}/>
							</Button>
						}
						<div className="clock">
							{this.state.start ? 
								(this.state.done ?
									<span>{this.formatTime(this.state.done)}</span> :
									<RelativeTime start={this.state.start}/>
								 ) :
								 <span>{this.formatTime(0)}</span>
							}
						</div>
					</div>
				</Container>
				<Container>
					<Editor disabled={!!this.state.done} code={this.state.code || ''} onCode={this.attach(this.onCode)} output={this.state.output} onCodeRef={ref => {
						this.code = ref;
						if (this.code) {
							this.code.getCodeMirror().off('cursorActivity', this.onCursorAttached);
							this.code.getCodeMirror().on('cursorActivity', this.onCursorAttached);
						}
					}}/>
				</Container>
			</Page>
		);
	}
}
