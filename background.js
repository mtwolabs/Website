/**
 * WebGL background renderer with mouse interaction.
 * Two-pass pipeline: scene → film grain post-process.
 */

import {
  oceanVertexSource,
  oceanFragmentSource,
  grainVertexSource,
  grainFragmentSource,
} from "./shaders.js";

class ShaderProgram {
  constructor(gl, vertexSrc, fragmentSrc) {
    this.gl = gl;
    this.program = this.build(vertexSrc, fragmentSrc);
    this.uniforms = {};
  }

  build(vertexSrc, fragmentSrc) {
    const gl = this.gl;
    const vs = this.compile(gl.VERTEX_SHADER, vertexSrc);
    const fs = this.compile(gl.FRAGMENT_SHADER, fragmentSrc);
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("Shader link error:", gl.getProgramInfoLog(program));
    }
    return program;
  }

  compile(type, source) {
    const gl = this.gl;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error("Shader compile error:", gl.getShaderInfoLog(shader));
    }
    return shader;
  }

  use() {
    this.gl.useProgram(this.program);
  }

  getUniform(name) {
    if (!(name in this.uniforms)) {
      this.uniforms[name] = this.gl.getUniformLocation(this.program, name);
    }
    return this.uniforms[name];
  }
}

class Framebuffer {
  constructor(gl, width, height) {
    this.gl = gl;
    this.texture = gl.createTexture();
    this.fbo = gl.createFramebuffer();
    this.resize(width, height);
  }

  resize(width, height) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
}

class BackgroundRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderScale = 0.7;
    this.gl = canvas.getContext("webgl", { antialias: false, alpha: false });
    this.mouseX = 0.5;
    this.mouseY = 0.5;
    this.smoothMouseX = 0.5;
    this.smoothMouseY = 0.5;
    this.clouds = canvas.dataset.clouds !== "false" ? 1.0 : 0.0;

    if (!this.gl) {
      console.warn("WebGL not supported");
      return;
    }

    this.sceneShader = new ShaderProgram(this.gl, oceanVertexSource, oceanFragmentSource);
    this.grainShader = new ShaderProgram(this.gl, grainVertexSource, grainFragmentSource);
    this.setupGeometry();
    this.resize();
    this.startTime = performance.now() / 1000;

    window.addEventListener("resize", () => this.resize());
    window.addEventListener("mousemove", (e) => this.onMouseMove(e));
    window.addEventListener("touchmove", (e) => this.onTouchMove(e));

    this.animate();
    this.canvas.classList.add("shader-ready");
  }

  onMouseMove(e) {
    this.mouseX = e.clientX / window.innerWidth;
    this.mouseY = 1.0 - e.clientY / window.innerHeight;
  }

  onTouchMove(e) {
    const touch = e.touches[0];
    this.mouseX = touch.clientX / window.innerWidth;
    this.mouseY = 1.0 - touch.clientY / window.innerHeight;
  }

  setupGeometry() {
    const gl = this.gl;
    const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
    this.quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  }

  resize() {
    const gl = this.gl;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const displayWidth = window.innerWidth;
    const displayHeight = window.innerHeight;

    this.canvas.style.width = displayWidth + "px";
    this.canvas.style.height = displayHeight + "px";

    const renderWidth = Math.floor(displayWidth * dpr * this.renderScale);
    const renderHeight = Math.floor(displayHeight * dpr * this.renderScale);

    this.canvas.width = renderWidth;
    this.canvas.height = renderHeight;

    if (this.framebuffer) {
      this.framebuffer.resize(renderWidth, renderHeight);
    } else {
      this.framebuffer = new Framebuffer(gl, renderWidth, renderHeight);
    }
  }

  drawQuad(shader) {
    const gl = this.gl;
    const posLoc = gl.getAttribLocation(shader.program, "aPosition");
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  render(time) {
    const gl = this.gl;
    const width = this.canvas.width;
    const height = this.canvas.height;

    // Smooth mouse interpolation
    this.smoothMouseX += (this.mouseX - this.smoothMouseX) * 0.03;
    this.smoothMouseY += (this.mouseY - this.smoothMouseY) * 0.03;

    // Pass 1: render scene to framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer.fbo);
    gl.viewport(0, 0, width, height);

    this.sceneShader.use();
    gl.uniform2f(this.sceneShader.getUniform("uResolution"), width, height);
    gl.uniform1f(this.sceneShader.getUniform("uTime"), time);
    gl.uniform2f(this.sceneShader.getUniform("uMouse"), this.smoothMouseX, this.smoothMouseY);
    gl.uniform1f(this.sceneShader.getUniform("uClouds"), this.clouds);
    this.drawQuad(this.sceneShader);

    // Pass 2: grain post-process to screen
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);

    this.grainShader.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.framebuffer.texture);
    gl.uniform1i(this.grainShader.getUniform("uTexture"), 0);
    gl.uniform2f(this.grainShader.getUniform("uResolution"), width, height);
    gl.uniform1f(this.grainShader.getUniform("uTime"), time);
    this.drawQuad(this.grainShader);
  }

  animate() {
    const time = performance.now() / 1000 - this.startTime;
    this.render(time);
    requestAnimationFrame(() => this.animate());
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const canvas = document.getElementById("ocean-canvas");
  if (canvas) {
    new BackgroundRenderer(canvas);
  }
});
