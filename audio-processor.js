class AudioStreamProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        
        // Cola de audio simple
        this.pendingBuffers = [];
        this.isPlaying = false;
        
        // Configuración de audio
        this.inputSampleRate = 16000;  // Android sample rate
        this.outputSampleRate = sampleRate; // Browser sample rate (48000)
        
        // Debug info
        console.log(`AudioProcessor - Input: ${this.inputSampleRate}Hz, Output: ${this.outputSampleRate}Hz`);
        
        // Receptor de mensajes
        this.port.onmessage = (event) => {
            if (event.data.type === 'audioData') {
                this.addAudioData(event.data.buffer);
            } else if (event.data.type === 'play') {
                this.isPlaying = true;
            } else if (event.data.type === 'pause') {
                this.isPlaying = false;
            } else if (event.data.type === 'stop') {
                this.isPlaying = false;
                this.pendingBuffers = [];
            }
        };
    }

    addAudioData(buffer) {
        try {
            // Convertir el buffer a Int16Array si no lo es ya
            const int16Buffer = buffer instanceof Int16Array ? buffer : new Int16Array(buffer);
            
            // Convertir a Float32Array (-1.0 a 1.0)
            const floatBuffer = new Float32Array(int16Buffer.length);
            for (let i = 0; i < int16Buffer.length; i++) {
                // Normalización más conservadora para evitar distorsión
                floatBuffer[i] = (int16Buffer[i] / 32768.0) * 0.8;
            }
            
            // Agregar a la cola
            this.pendingBuffers.push(floatBuffer);
            
            // Mantener la cola en un tamaño razonable
            if (this.pendingBuffers.length > 20) {
                this.pendingBuffers.shift();
            }
        } catch (error) {
            console.error('Error procesando buffer de audio:', error);
        }
    }

    process(inputs, outputs, parameters) {
        const output = outputs[0];
        const channel = output[0];
        
        // Si no estamos reproduciendo o no hay datos, silencio
        if (!this.isPlaying || this.pendingBuffers.length === 0) {
            channel.fill(0);
            return true;
        }

        try {
            // Obtener el próximo buffer
            const currentBuffer = this.pendingBuffers[0];
            
            // Si no hay suficientes muestras, rellenar con silencio
            if (!currentBuffer || currentBuffer.length === 0) {
                channel.fill(0);
                return true;
            }

            // Calcular cuántas muestras necesitamos del buffer de entrada
            const outputLength = channel.length;
            const scaleFactor = this.inputSampleRate / this.outputSampleRate;
            const neededInputSamples = Math.ceil(outputLength * scaleFactor);

            // Si tenemos suficientes muestras en el buffer actual
            if (currentBuffer.length >= neededInputSamples) {
                // Copiar y remuestrear las muestras necesarias
                for (let i = 0; i < outputLength; i++) {
                    const inputIndex = Math.floor(i * scaleFactor);
                    if (inputIndex < currentBuffer.length) {
                        const sample = currentBuffer[inputIndex];
                        // Aplicar a todos los canales de salida
                        for (let channelIdx = 0; channelIdx < output.length; channelIdx++) {
                            output[channelIdx][i] = sample;
                        }
                    } else {
                        // Rellenar con ceros si nos quedamos sin muestras
                        for (let channelIdx = 0; channelIdx < output.length; channelIdx++) {
                            output[channelIdx][i] = 0;
                        }
                    }
                }

                // Remover el buffer procesado
                this.pendingBuffers.shift();
            } else {
                // No tenemos suficientes muestras, esperar más datos
                channel.fill(0);
            }
        } catch (error) {
            console.error('Error en el procesamiento de audio:', error);
            channel.fill(0);
        }

        return true;
    }
}

registerProcessor('audio-processor', AudioStreamProcessor);
