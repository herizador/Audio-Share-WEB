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
        this.resampleRatio = this.outputSampleRate / this.inputSampleRate; // Debe ser 3
        this.minBuffers = 4;  // Aumentado para tener más margen
        this.maxBuffers = 10; // Reducido para menor latencia
        this.inputBufferSize = 320; // Tamaño real del buffer de entrada
        
        // Buffer de trabajo para suavizar la salida
        this.workBuffer = new Float32Array(this.inputBufferSize * 4); // Duplicado para más margen
        this.workBufferFilled = 0;
        
        // Contadores para diagnóstico
        this.buffersReceived = 0;
        this.buffersProcessed = 0;
        this.lastLogTime = Date.now();
        this.underruns = 0;
        
        console.log(`AudioProcessor Iniciado:
- Sample Rate Entrada: ${this.inputSampleRate}Hz
- Sample Rate Salida: ${this.outputSampleRate}Hz
- Ratio de Remuestreo: ${this.resampleRatio}
- Tamaño de Buffer Entrada: ${this.inputBufferSize} muestras
- Tamaño de Buffer Trabajo: ${this.workBuffer.length} muestras`);
        
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
- Reproduciendo: ${this.isPlaying}
- Underruns: ${this.underruns}
- Work Buffer: ${this.workBufferFilled}/${this.workBuffer.length}
- Current Offset: ${this.currentOffset}`);
                    this.lastLogTime = now;
                    this.underruns = 0;
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
                this.workBufferFilled = 0;
                this.currentOffset = 0;
                this.buffersReceived = 0;
                this.buffersProcessed = 0;
                this.underruns = 0;
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
                this.buffersProcessed++;
            }
        } catch (error) {
            console.error('Error procesando buffer de audio:', error);
        }
    }

    fillWorkBuffer() {
        // Si el buffer está muy lleno, descartamos datos antiguos
        if (this.workBufferFilled >= this.workBuffer.length - this.inputBufferSize) {
            this.workBufferFilled = 0;
            this.currentOffset = 0;
        }
        
        // Mientras haya espacio y buffers pendientes
        while (this.workBufferFilled < this.workBuffer.length - this.inputBufferSize && 
               this.pendingBuffers.length > 0) {
            const nextBuffer = this.pendingBuffers.shift();
            
            if (this.workBufferFilled + nextBuffer.length <= this.workBuffer.length) {
                this.workBuffer.set(nextBuffer, this.workBufferFilled);
                this.workBufferFilled += nextBuffer.length;
                this.buffersProcessed++;
            } else {
                // Si no cabe completo, lo devolvemos a la cola
                this.pendingBuffers.unshift(nextBuffer);
                break;
            }
        }
    }

    process(inputs, outputs, parameters) {
        const output = outputs[0];
        const channel = output[0];
        
        // Esperar a tener suficientes datos
        if (!this.isPlaying || (this.pendingBuffers.length < this.minBuffers && 
            this.workBufferFilled - this.currentOffset < this.inputBufferSize)) {
            channel.fill(0);
            if (this.isPlaying) this.underruns++;
            return true;
        }

        try {
            // Rellenar el buffer de trabajo si es necesario
            if (this.workBufferFilled - this.currentOffset < this.inputBufferSize) {
                this.fillWorkBuffer();
            }
            
            // Procesar cada muestra del buffer de salida
            for (let i = 0; i < channel.length; i++) {
                // Calcular la posición en el buffer de entrada
                const inputPos = i / this.resampleRatio + this.currentOffset;
                const inputIndex = Math.floor(inputPos);
                
                // Verificar límites
                if (inputIndex + 1 >= this.workBufferFilled) {
                    // Mantener última muestra válida
                    const lastSample = inputIndex > 0 ? this.workBuffer[inputIndex - 1] : 0;
                    for (let j = i; j < channel.length; j++) {
                        for (let channelIdx = 0; channelIdx < output.length; channelIdx++) {
                            output[channelIdx][j] = lastSample;
                        }
                    }
                    break;
                }
                
                // Interpolación lineal entre muestras
                const fraction = inputPos - inputIndex;
                const sample1 = this.workBuffer[inputIndex];
                const sample2 = this.workBuffer[inputIndex + 1];
                const interpolatedSample = sample1 + (sample2 - sample1) * fraction;
                
                // Aplicar a todos los canales
                for (let channelIdx = 0; channelIdx < output.length; channelIdx++) {
                    output[channelIdx][i] = interpolatedSample;
                }
            }
            
            // Actualizar offset
            const samplesProcessed = Math.floor(channel.length / this.resampleRatio);
            this.currentOffset += samplesProcessed;
            
            // Si el offset es muy grande, reiniciamos el buffer
            if (this.currentOffset >= this.workBufferFilled || 
                this.currentOffset >= this.workBuffer.length - this.inputBufferSize) {
                this.workBufferFilled = 0;
                this.currentOffset = 0;
            }
            
        } catch (error) {
            console.error('Error en el procesamiento de audio:', error);
            channel.fill(0);
        }

        return true;
    }
}

registerProcessor('audio-processor', AudioStreamProcessor); 
