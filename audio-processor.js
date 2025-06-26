class AudioStreamProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        
        // Cola de audio con buffer más grande
        this.pendingBuffers = [];
        this.isPlaying = false;
        
        // Configuración de audio
        this.inputSampleRate = 16000;  // Android sample rate
        this.outputSampleRate = sampleRate; // Browser sample rate (48000)
        this.minBuffers = 2;  // Mínimo de buffers antes de empezar a reproducir
        this.maxBuffers = 50; // Máximo de buffers para evitar delay
        
        // Contadores para diagnóstico
        this.buffersReceived = 0;
        this.buffersProcessed = 0;
        this.lastLogTime = Date.now();
        
        console.log(`AudioProcessor Iniciado:
- Sample Rate Entrada: ${this.inputSampleRate}Hz
- Sample Rate Salida: ${this.outputSampleRate}Hz
- Factor de Escala: ${this.inputSampleRate / this.outputSampleRate}
- Tamaño de Cola: ${this.maxBuffers} buffers`);
        
        this.port.onmessage = (event) => {
            if (event.data.type === 'audioData') {
                this.addAudioData(event.data.buffer);
                
                // Log de diagnóstico cada segundo
                const now = Date.now();
                if (now - this.lastLogTime >= 1000) {
                    console.log(`Estado del Audio:
- Buffers en Cola: ${this.pendingBuffers.length}
- Buffers Recibidos: ${this.buffersReceived}
- Buffers Procesados: ${this.buffersProcessed}
- Reproduciendo: ${this.isPlaying}`);
                    this.lastLogTime = now;
                }
            } else if (event.data.type === 'play') {
                this.isPlaying = true;
                console.log('Reproducción iniciada');
            } else if (event.data.type === 'pause') {
                this.isPlaying = false;
                console.log('Reproducción pausada');
            } else if (event.data.type === 'stop') {
                this.isPlaying = false;
                this.pendingBuffers = [];
                this.buffersReceived = 0;
                this.buffersProcessed = 0;
                console.log('Reproducción detenida');
            }
        };
    }

    addAudioData(buffer) {
        try {
            // Convertir el buffer a Int16Array si no lo es ya
            const int16Buffer = buffer instanceof Int16Array ? buffer : new Int16Array(buffer);
            
            // Log del tamaño del buffer recibido
            if (this.buffersReceived === 0) {
                console.log(`Primer buffer recibido - Tamaño: ${int16Buffer.length} muestras`);
            }
            
            // Convertir a Float32Array (-1.0 a 1.0)
            const floatBuffer = new Float32Array(int16Buffer.length);
            for (let i = 0; i < int16Buffer.length; i++) {
                // Normalización con factor de escala ajustado
                floatBuffer[i] = (int16Buffer[i] / 32768.0) * 0.95;
            }
            
            this.pendingBuffers.push(floatBuffer);
            this.buffersReceived++;
            
            // Mantener la cola en un tamaño razonable
            while (this.pendingBuffers.length > this.maxBuffers) {
                this.pendingBuffers.shift();
                console.log('Buffer descartado por overflow');
            }
        } catch (error) {
            console.error('Error procesando buffer de audio:', error);
        }
    }

    process(inputs, outputs, parameters) {
        const output = outputs[0];
        const channel = output[0];
        
        // Esperar a tener suficientes buffers antes de empezar
        if (!this.isPlaying || this.pendingBuffers.length < this.minBuffers) {
            channel.fill(0);
            return true;
        }

        try {
            const currentBuffer = this.pendingBuffers[0];
            
            if (!currentBuffer || currentBuffer.length === 0) {
                channel.fill(0);
                return true;
            }

            // Calcular el factor de remuestreo
            const scaleFactor = this.inputSampleRate / this.outputSampleRate;
            const outputLength = channel.length;
            
            // Procesar las muestras
            for (let i = 0; i < outputLength; i++) {
                const inputIndex = Math.floor(i * scaleFactor);
                let sample = 0;
                
                if (inputIndex < currentBuffer.length) {
                    // Interpolación lineal simple entre muestras
                    const index1 = inputIndex;
                    const index2 = Math.min(index1 + 1, currentBuffer.length - 1);
                    const fraction = (i * scaleFactor) - index1;
                    
                    sample = currentBuffer[index1] * (1 - fraction) + 
                            currentBuffer[index2] * fraction;
                }
                
                // Aplicar a todos los canales
                for (let channelIdx = 0; channelIdx < output.length; channelIdx++) {
                    output[channelIdx][i] = sample;
                }
            }
            
            // Remover el buffer procesado
            this.pendingBuffers.shift();
            this.buffersProcessed++;
            
        } catch (error) {
            console.error('Error en el procesamiento de audio:', error);
            channel.fill(0);
        }

        return true;
    }
}

registerProcessor('audio-processor', AudioStreamProcessor); 
