export const vertexShader = `#version 300 es

uniform vec3 uBaseColor;
uniform vec3 uSecondaryColor;
uniform vec3 uAccentColor;
uniform float uTime;
uniform float uAmplitude;
uniform float uColorCycleSpeed;
uniform float uColorMixIntensity;

in vec2 inPosition;

out vec2 fragUV;
out vec3 fragBaseColor;
out vec3 fragSecondaryColor;
out vec3 fragAccentColor;
out float fragTime;
out float fragAmplitude;
out float fragColorCycleSpeed;
out float fragColorMixIntensity;

void main() {
    gl_Position = vec4(inPosition, 0.0, 1.0);
    fragUV = (inPosition + 1.0) / 2.0;
    fragBaseColor = uBaseColor;
    fragSecondaryColor = uSecondaryColor;
    fragAccentColor = uAccentColor;
    fragTime = uTime;
    fragAmplitude = uAmplitude;
    fragColorCycleSpeed = uColorCycleSpeed;
    fragColorMixIntensity = uColorMixIntensity;
}
`;
export const fragmentShader = `#version 300 es
precision highp float;

uniform sampler2D uBlurredTexture;
uniform sampler2D uOriginalTexture;

in vec2 fragUV;
in vec3 fragBaseColor;
in vec3 fragSecondaryColor;
in vec3 fragAccentColor;
in float fragTime;
in float fragAmplitude;
in float fragColorCycleSpeed;
in float fragColorMixIntensity;

out vec4 outColor;

void main() {
    float value = max(texture(uBlurredTexture, fragUV).r, texture(uOriginalTexture, fragUV).r);
    
    // Simple time-based color cycling
    float colorPhase = fragTime * fragColorCycleSpeed;
    
    // Create simple color transitions
    float cycle1 = sin(colorPhase) * 0.5 + 0.5;
    float cycle2 = sin(colorPhase * 1.3 + 2.0) * 0.5 + 0.5;
    
    // Mix between base and secondary colors
    vec3 color1 = mix(fragBaseColor, fragSecondaryColor, cycle1);
    
    // Add some accent color based on amplitude
    vec3 finalColor = mix(color1, fragAccentColor, cycle2 * fragAmplitude * 0.3);
    
    // Boost colors based on amplitude
    finalColor *= (1.0 + fragAmplitude * fragColorMixIntensity * 0.5);
    
    outColor = vec4(finalColor * value, value);
}
`;
