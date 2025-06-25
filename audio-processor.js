// audio-processor.js
class AudioStreamProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.audioQueue = [];
        this.isPlaying = false;
        
        // --- CONFIGURACIÓN BÁSICA ---
        this.MAX_QUEUE_SIZE = 50;
        this.MIN_BUFFER_THRESHOLD = 10;
        this.smoothingFactor = 0.6;
        this.lastSample = 0;
        
        // Control de estado
        this.underrunCount = 0;
        this.lastUnderrunTime = 0;
        
        this.port.onmessage = (event) => {
            if (event.data.type === 'audioData') {
                if (this.audioQueue.length < this.MAX_QUEUE_SIZE) {
                    const processedBuffer = this.preprocessBuffer(event.data.buffer);
                    if (processedBuffer) {
                        this.audioQueue.push(processedBuffer);
                    }
                } else {
                    this.audioQueue.shift();
                    const processedBuffer = this.preprocessBuffer(event.data.buffer);
                    if (processedBuffer) {
                        this.audioQueue.push(processedBuffer);
                    }
                }
            } else if (event.data.type === 'play') {
                this.isPlaying = true;
            } else if (event.data.type === 'pause') {
                this.isPlaying = false;
            } else if (event.data.type === 'stop') {
                this.isPlaying = false;
                this.audioQueue = [];
                this.lastSample = 0;
            }
        };
    }

    preprocessBuffer(buffer) {
        try {
            const int16Buffer = buffer instanceof Int16Array ? buffer : new Int16Array(buffer);
            const float32Buffer = new Float32Array(int16Buffer.length);
            
            for (let i = 0; i < int16Buffer.length; i++) {
                float32Buffer[i] = int16Buffer[i] / 32768.0;
            }
            
            return float32Buffer;
        } catch (error) {
            console.error('Error preprocessing buffer:', error);
            return null;
        }
    }

    process(inputs, outputs, parameters) {
        const output = outputs[0];
        const channel = output[0];
        
        if (this.audioQueue.length < this.MIN_BUFFER_THRESHOLD || !this.isPlaying) {
            if (this.isPlaying && this.audioQueue.length === 0) {
                if (currentTime - this.lastUnderrunTime < 1) {
                    this.underrunCount++;
                    if (this.underrunCount > 2) {
                        this.MIN_BUFFER_THRESHOLD = Math.min(20, this.MIN_BUFFER_THRESHOLD + 2);
                        this.underrunCount = 0;
                    }
                } else {
                    this.underrunCount = 0;
                }
                this.lastUnderrunTime = currentTime;
            }
            
            // Fade out suave
            for (let i = 0; i < channel.length; i++) {
                this.lastSample *= 0.95;
                channel[i] = this.lastSample;
            }
            return true;
        }

        const currentBuffer = this.audioQueue.shift();
        if (!currentBuffer) {
            channel.fill(this.lastSample);
            return true;
        }

        try {
            // Procesamiento directo sin remuestreo
            const samplesPerFrame = channel.length;
            const inputLength = currentBuffer.length;
            const skipRatio = inputLength / samplesPerFrame;
            
            for (let i = 0; i < samplesPerFrame; i++) {
                const inputIndex = Math.min(Math.floor(i * skipRatio), inputLength - 1);
                const sample = currentBuffer[inputIndex];
                
                // Suavizado simple
                this.lastSample = this.lastSample * this.smoothingFactor + 
                                sample * (1 - this.smoothingFactor);
                channel[i] = this.lastSample;
            }
            
        } catch (error) {
            console.error('Error processing audio frame:', error);
            channel.fill(this.lastSample);
        }

        return true;
    }
}

registerProcessor('audio-processor', AudioStreamProcessor);
