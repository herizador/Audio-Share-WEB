class AudioStreamProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        
        // Cola de audio con buffer más grande
        this.pendingBuffers = [];
        this.isPlaying = false;
        this.currentOffset = 0;
        
        // Configuración de audio
        this.inputSampleRate = 16000;  // Android sample rate
        this.outputSampleRate = sampleRate; // Browser sample rate (48000)
        this.resampleRatio = this.outputSampleRate / this.inputSampleRate;
        this.minBuffers = 3;
        this.maxBuffers = 15;
        this.inputBufferSize = 320;
        this.processingChunkSize = 128;
        
        // Buffer de trabajo
        this.workBuffer = new Float32Array(this.inputBufferSize * 6);
        this.workBufferFilled = 0;
        
        // Variables para suavizado adaptativo
        this.lastSample = 0;
        this.smoothingFactor = 0.15;
        this.transitionWindow = 8;
        this.lastSamples = new Float32Array(this.transitionWindow).fill(0);
        this.lastSampleIndex = 0;
        
        // Contadores para diagnóstico (solo si debug está activo)
        this.debug = false; // Debug desactivado por defecto
        this.buffersReceived = 0;
        this.buffersProcessed = 0;
        this.lastLogTime = 0;
        this.underruns = 0;
        this.totalSamplesProcessed = 0;
        
        // Log inicial de configuración (solo una vez)
        console.log(`AudioProcessor Iniciado:
- Sample Rate Entrada: ${this.inputSampleRate}Hz
- Sample Rate Salida: ${this.outputSampleRate}Hz
- Ratio de Remuestreo: ${this.resampleRatio}
- Factor de Suavizado: ${this.smoothingFactor}`);
        
        this.port.onmessage = (event) => {
            if (event.data.type === 'audioData') {
                this.addAudioData(event.data.buffer);
                this.logMetricsIfDebug();
            } else if (event.data.type === 'play') {
                this.isPlaying = true;
                console.log('Reproducción iniciada');
            } else if (event.data.type === 'pause') {
                this.isPlaying = false;
                console.log('Reproducción pausada');
            } else if (event.data.type === 'stop') {
                this.isPlaying = false;
                this.resetState();
                console.log('Reproducción detenida');
            } else if (event.data.type === 'debug') {
                this.debug = event.data.enabled;
                console.log(`Modo debug ${this.debug ? 'activado' : 'desactivado'}`);
            }
        };
    }

    resetState() {
        this.pendingBuffers = [];
        this.workBufferFilled = 0;
        this.currentOffset = 0;
        this.buffersReceived = 0;
        this.buffersProcessed = 0;
        this.underruns = 0;
        this.lastSample = 0;
        this.lastSamples.fill(0);
        this.totalSamplesProcessed = 0;
    }

    logMetricsIfDebug() {
        if (!this.debug) return;
        
        const now = Date.now();
        if (now - this.lastLogTime >= 1000) {
            const metrics = {
                buffersInQueue: this.pendingBuffers.length,
                received: this.buffersReceived,
                processed: this.buffersProcessed,
                playing: this.isPlaying,
                underruns: this.underruns,
                workBuffer: `${this.workBufferFilled}/${this.workBuffer.length}`,
                offset: this.currentOffset,
                samplesPerSecond: this.totalSamplesProcessed
            };
            
            console.log('Estado del Audio:', metrics);
            
            this.lastLogTime = now;
            this.underruns = 0;
            this.totalSamplesProcessed = 0;
        }
    }

    addAudioData(buffer) {
        try {
            const int16Buffer = buffer instanceof Int16Array ? buffer : new Int16Array(buffer);
            
            if (this.debug && this.buffersReceived === 0) {
                console.log(`Primer buffer recibido - Tamaño: ${int16Buffer.length} muestras`);
            }
            
            // Convertir a Float32Array con suavizado adaptativo
            const floatBuffer = new Float32Array(int16Buffer.length);
            for (let i = 0; i < int16Buffer.length; i++) {
                const sample = int16Buffer[i] / 32768.0;
                
                // Detectar transiciones bruscas
                const avgLastSamples = this.lastSamples.reduce((a, b) => a + b, 0) / this.transitionWindow;
                const delta = Math.abs(sample - avgLastSamples);
                
                // Ajustar factor de suavizado según la transición
                const dynamicFactor = delta > 0.1 ? 0.05 : this.smoothingFactor;
                
                // Aplicar suavizado adaptativo
                this.lastSample = sample * (1 - dynamicFactor) + this.lastSample * dynamicFactor;
                floatBuffer[i] = this.lastSample;
                
                // Actualizar historial de muestras
                this.lastSamples[this.lastSampleIndex] = sample;
                this.lastSampleIndex = (this.lastSampleIndex + 1) % this.transitionWindow;
            }
            
            this.pendingBuffers.push(floatBuffer);
            this.buffersReceived++;
            
            while (this.pendingBuffers.length > this.maxBuffers) {
                this.pendingBuffers.shift();
                this.buffersProcessed++;
            }
        } catch (error) {
            console.error('Error procesando buffer de audio:', error);
        }
    }

    fillWorkBuffer() {
        if (this.currentOffset > 0 && this.workBufferFilled > this.currentOffset) {
            const remainingSamples = this.workBufferFilled - this.currentOffset;
            this.workBuffer.copyWithin(0, this.currentOffset, this.workBufferFilled);
            this.workBufferFilled = remainingSamples;
            this.currentOffset = 0;
        } else if (this.currentOffset >= this.workBufferFilled) {
            this.workBufferFilled = 0;
            this.currentOffset = 0;
        }
        
        while (this.workBufferFilled < this.workBuffer.length - this.inputBufferSize && 
               this.pendingBuffers.length > 0) {
            const nextBuffer = this.pendingBuffers[0];
            
            if (this.workBufferFilled + nextBuffer.length <= this.workBuffer.length) {
                this.workBuffer.set(nextBuffer, this.workBufferFilled);
                this.workBufferFilled += nextBuffer.length;
                this.pendingBuffers.shift();
                this.buffersProcessed++;
            } else {
                break;
            }
        }
    }

    process(inputs, outputs, parameters) {
        const output = outputs[0];
        const channel = output[0];
        
        if (!this.isPlaying || (this.pendingBuffers.length < this.minBuffers && 
            this.workBufferFilled - this.currentOffset < this.processingChunkSize)) {
            channel.fill(0);
            if (this.isPlaying) this.underruns++;
            return true;
        }

        try {
            if (this.workBufferFilled - this.currentOffset < this.processingChunkSize * 2) {
                this.fillWorkBuffer();
            }
            
            for (let i = 0; i < channel.length; i++) {
                const inputPos = i / this.resampleRatio + this.currentOffset;
                const inputIndex = Math.floor(inputPos);
                
                if (inputIndex + 1 >= this.workBufferFilled) {
                    const lastSample = this.lastSample * 0.98;
                    for (let j = i; j < channel.length; j++) {
                        for (let channelIdx = 0; channelIdx < output.length; channelIdx++) {
                            output[channelIdx][j] = lastSample;
                        }
                        this.lastSample = lastSample;
                    }
                    break;
                }
                
                const fraction = inputPos - inputIndex;
                const sample1 = this.workBuffer[inputIndex];
                const sample2 = this.workBuffer[inputIndex + 1];
                
                // Interpolación cúbica para mejor calidad
                const sample0 = inputIndex > 0 ? this.workBuffer[inputIndex - 1] : sample1;
                const sample3 = inputIndex < this.workBufferFilled - 2 ? 
                               this.workBuffer[inputIndex + 2] : sample2;
                
                const a0 = sample3 - sample2 - sample0 + sample1;
                const a1 = sample0 - sample1 - a0;
                const a2 = sample2 - sample0;
                const a3 = sample1;
                
                const interpolatedSample = a0 * Math.pow(fraction, 3) + 
                                        a1 * Math.pow(fraction, 2) + 
                                        a2 * fraction + a3;
                
                for (let channelIdx = 0; channelIdx < output.length; channelIdx++) {
                    output[channelIdx][i] = interpolatedSample;
                }
                
                this.lastSample = interpolatedSample;
            }
            
            const samplesProcessed = Math.floor(channel.length / this.resampleRatio);
            this.currentOffset += samplesProcessed;
            this.totalSamplesProcessed += samplesProcessed;
            
        } catch (error) {
            console.error('Error en el procesamiento de audio:', error);
            channel.fill(0);
        }

        return true;
    }
}

registerProcessor('audio-processor', AudioStreamProcessor); 
