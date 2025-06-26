class AudioStreamProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        
        // Cola de audio con buffer más grande
        this.pendingBuffers = [];
        this.isPlaying = false;
        
        // Configuración de audio
        this.inputSampleRate = 16000;  // Android sample rate
        this.outputSampleRate = sampleRate; // Browser sample rate (48000)
        this.resampleRatio = this.outputSampleRate / this.inputSampleRate; // Debe ser 3
        this.minBuffers = 2;
        this.maxBuffers = 50;
        
        // Contadores para diagnóstico
        this.buffersReceived = 0;
        this.buffersProcessed = 0;
        this.lastLogTime = Date.now();
        
        console.log(`AudioProcessor Iniciado:
- Sample Rate Entrada: ${this.inputSampleRate}Hz
- Sample Rate Salida: ${this.outputSampleRate}Hz
- Ratio de Remuestreo: ${this.resampleRatio}
- Tamaño de Buffer Entrada: ${128} muestras
- Tamaño de Buffer Salida: ${128 * this.resampleRatio} muestras`);
        
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
                floatBuffer[i] = int16Buffer[i] / 32768.0;
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

            // Procesar cada muestra del buffer de salida
            for (let i = 0; i < channel.length; i++) {
                // Calcular la posición en el buffer de entrada
                const inputPos = i / this.resampleRatio;
                const inputIndex = Math.floor(inputPos);
                
                if (inputIndex >= currentBuffer.length) {
                    // Si necesitamos más muestras del siguiente buffer
                    break;
                }
                
                // Obtener la muestra actual y la siguiente para interpolación
                const sample1 = currentBuffer[inputIndex];
                const sample2 = inputIndex + 1 < currentBuffer.length ? 
                              currentBuffer[inputIndex + 1] : 
                              sample1;
                
                // Calcular la fracción para interpolación
                const fraction = inputPos - inputIndex;
                
                // Interpolar entre las dos muestras
                const interpolatedSample = sample1 + (sample2 - sample1) * fraction;
                
                // Aplicar a todos los canales
                for (let channelIdx = 0; channelIdx < output.length; channelIdx++) {
                    output[channelIdx][i] = interpolatedSample;
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
