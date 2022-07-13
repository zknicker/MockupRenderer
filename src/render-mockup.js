import * as THREE from "three";
import * as dat from "dat.gui";

export default async function(mockup, design, displacementMap, parent) {
    var vertex = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`;

    var fragment = `
varying vec2 vUv;

uniform sampler2D displacementMap;
uniform sampler2D mockup;
uniform sampler2D design;
uniform bool multiply;
uniform bool displacement;
uniform float displacementIntensity;
uniform float multiplyIntensity;
uniform float blendOpacity;
uniform vec2 designScale;
uniform float rotation;
uniform float offsetX;
uniform float offsetY;
uniform vec2 mockupOffset;
uniform vec2 mockupSize;

mat2 getRotM(float ang) {
  float s = sin(ang);
  float c = cos(ang);
  return mat2(c, -s, s, c);
}

vec2 rotateUV(vec2 uv, float rotation, float mid) {
    return vec2(
      cos(rotation) * (uv.x - mid) + sin(rotation) * (uv.y - mid) + mid,
      cos(rotation) * (uv.y - mid) - sin(rotation) * (uv.x - mid) + mid
    );
}

void main() {
    // Translate mockup UVs to position mockup in render space. This UV is used for the mockup, and the mockup displacement map.
    float mockupTranslatedX = vUv.x * mockupSize.x + mockupOffset.x;
    float mockupTranslatedY = vUv.y * mockupSize.y + mockupOffset.y;
    vec2 mockupTranslatedUV = vec2(mockupTranslatedX, mockupTranslatedY);

    // Calculate displacement map vector.
    vec4 displacementMapTex = texture2D(displacementMap, mockupTranslatedUV);
    vec2 displacementVector = vec2(0,0);
    if (displacement) {
        displacementVector = vec2(displacementMapTex.r, displacementMapTex.g);
    }

    // Get offset translated UV
    vec2 translatedUV = vUv - vec2(offsetX, offsetY);

    // Get scaled design UV.
    vec2 scaledDesignUV = (translatedUV - vec2(0.5)) * 1.0/designScale + vec2(0.5);

    // Get rotated UV
    vec2 rotatedUV = rotateUV(scaledDesignUV, rotation, 0.5);

    // Use the grayscale constant (e.g. [170/255, 170/255]) to displace our UV coord.
    vec2 distortedPosition = rotatedUV + displacementVector * displacementIntensity - vec2(displacementIntensity);

    vec4 _mockup = texture2D(mockup, mockupTranslatedUV);
    vec4 _design = texture2D(design, distortedPosition);

    if (multiply) {
        // Use multiply blending to merge the mockup and design textures.
        vec3 blended = _mockup.rgb * (1.0 - _design.a) + ((_mockup.rgb - vec3(multiplyIntensity)) * _design.rgb * _design.a);
        
        vec3 blendedWithOpacity = blended * blendOpacity + _mockup.rgb * (1.0 - blendOpacity);
        gl_FragColor = vec4(blendedWithOpacity, 1.0);

    } else {
        vec3 blended = _mockup.rgb * (1.0 - _design.a) + _design.rgb * _design.a;
        gl_FragColor = vec4(blended, 1.0);
    }
}
`;

    /**
     * Configurable parameters
     */
    const renderHeight = 1000;
    const renderWidth = 1000;
    var data = {
        multiply: true,
        displacement: true,
        displacementIntensity: 0.012,
        multiplyIntensity: -0.15,
        blendOpacity: 0.95,
        rotation: -5,
        offsetX: 17,
        offsetY: 70,
        scale: 0.45,
    };

    const gui = new dat.GUI();
    gui.add(data, "multiply");
    gui.add(data, "displacement");
    gui.add(data, "displacementIntensity", 0, 0.02, 0.001);
    gui.add(data, "multiplyIntensity", -0.5, 0.5, 0.05);
    gui.add(data, "blendOpacity", 0, 1, 0.05);
    gui.add(data, "rotation", -10, 10, 0.5).listen();
    gui.add(data, "offsetX", -200, 200, 1).listen();
    gui.add(data, "offsetY", -200, 200, 1).listen();
    gui.add(data, "scale", 0, 1, 0.01).listen();

    var loader = new THREE.TextureLoader();
    loader.crossOrigin = "";

    /**
     * Load in all of our textures for the mockup, design, and displacement map.
     */
    const promiseLoader = (url) =>
        new Promise((resolve, reject) => {
            loader.load(url, (data) => resolve(data), null, reject);
        });

    var mockupTexture = await promiseLoader(mockup);
    var designTexture = await promiseLoader(design);
    var displacementMapTexture = await promiseLoader(displacementMap);
    mockupTexture.magFilter = mockupTexture.minFilter = THREE.LinearFilter;
    designTexture.magFilter = designTexture.minFilter = THREE.LinearFilter;
    displacementMapTexture.magFilter = displacementMapTexture.minFilter = THREE.LinearFilter;

    const mockupWidth = mockupTexture.image.width;
    const mockupHeight = mockupTexture.image.height;
    const designWidth = designTexture.image.width;
    const designHeight = designTexture.image.height;
    const mockupAspectRatio = mockupWidth / mockupHeight;
    const renderAspectRatio = renderWidth / renderHeight;
    const designAspectRatio = designWidth / designHeight;

    /**
     * Compute mockup & design image scaling and translation.
     */
    let mW = 0;
    let mH = 0;
    let dW = 0;
    let dH = 0;
    if (mockupAspectRatio == renderAspectRatio) {
        // ▓▓ « ▓▓
        mW = renderWidth;
        mH = renderHeight;
        dH = 1.0; // entire y-axis used to render design (aka full mockup height)
        dW = (renderHeight * designAspectRatio) / renderWidth; // % of x-axis used to render design
    } else if (mockupAspectRatio > renderAspectRatio) {
        // ▓▓ « ▓▓▓▓
        mW = renderHeight * mockupAspectRatio;
        mH = renderHeight;
        dH = 1.0; // entire y-axis used to render design (aka full mockup height)
        dW = (renderHeight * designAspectRatio) / renderWidth; // % of x-axis used to render design
    } else if (mockupAspectRatio < renderAspectRatio) {
        // ▓▓ « ▓
        mW = renderWidth;
        mH = renderWidth / mockupAspectRatio;
        dH = 1.0 / (renderHeight / mH); // more than 100% of y-axis used to render design, because a portion of the mockup y-axis is off screen
        dW = (mH * designAspectRatio) / renderWidth; // calculate % of x-axis used to render design
    }

    // Mockup Size is the % of the mockup visible in the render area (e.g. 80% X, and 100% Y for the ▓▓ « ▓▓▓▓ case)
    const mockupSize = new THREE.Vector2(renderWidth / mW, renderHeight / mH);

    // Mockup Offset centers the newly sized mockupin the render area.
    const mockupOffset = new THREE.Vector2((1 - mockupSize.x) / 2, (1 - mockupSize.y) / 2);

    const computeDesignScale = (scale) => new THREE.Vector2(dW * scale, dH * scale);
    const computeDesignRotation = (degrees) => (degrees / 360) * Math.PI * 2;
    const computeDesignOffset = (offset) => offset / 1000;

    /**
     * Uniforms
     */
    var mat = new THREE.ShaderMaterial({
        uniforms: {
            displacementIntensity: {
                type: "f",
                value: data.displacementIntensity,
            },
            mockup: {
                type: "t",
                value: mockupTexture,
            },
            design: {
                type: "t",
                value: designTexture,
            },
            designScale: {
                type: "vec2",
                value: computeDesignScale(data.scale),
            },
            offsetX: {
                type: "f",
                value: computeDesignOffset(data.offsetX),
            },
            offsetY: {
                type: "f",
                value: computeDesignOffset(data.offsetY),
            },
            mockupOffset: {
                type: "vec2",
                value: mockupOffset,
            },
            mockupSize: {
                type: "vec2",
                value: mockupSize,
            },
            displacementMap: {
                type: "t",
                value: displacementMapTexture,
            },
            multiply: {
                type: "bool",
                value: data.multiply,
            },
            multiplyIntensity: {
                type: "f",
                value: data.multiplyIntensity,
            },
            blendOpacity: {
                type: "f",
                value: data.blendOpacity,
            },
            displacement: {
                type: "bool",
                value: data.displacement,
            },
            rotation: {
                type: "f",
                value: computeDesignRotation(data.rotation),
            },
        },

        vertexShader: vertex,
        fragmentShader: fragment,
        transparent: true,
        opacity: 1.0,
    });

    /**
     * Configure ThreeJS scene and add the rendering Canvas to the DOM.
     */
    var scene = new THREE.Scene();
    var camera = new THREE.OrthographicCamera(renderWidth / -2, renderWidth / 2, renderHeight / 2, renderHeight / -2, 1, 1000);
    camera.position.z = 1;

    var renderer = new THREE.WebGLRenderer({
        antialias: false,
        alpha: true,
    });
    renderer.setPixelRatio(2.0);
    renderer.setClearColor(0xffffff, 0.0);
    renderer.setSize(renderWidth, renderHeight);

    const domElem = renderer.domElement;
    domElem.style.height = renderHeight;
    domElem.style.width = renderWidth;
    parent.appendChild(domElem);

    var geometry = new THREE.PlaneBufferGeometry(renderWidth, renderHeight, 1);
    var object = new THREE.Mesh(geometry, mat);
    scene.add(object);

    /**
     * Render loop
     */
    var render = function() {
        window.requestAnimationFrame(render);
        mat.uniforms.multiply.value = data.multiply;
        mat.uniforms.displacement.value = data.displacement;
        mat.uniforms.displacementIntensity.value = data.displacementIntensity;
        mat.uniforms.multiplyIntensity.value = data.multiplyIntensity;
        mat.uniforms.blendOpacity.value = data.blendOpacity;
        mat.uniforms.rotation.value = computeDesignRotation(data.rotation);
        mat.uniforms.offsetX.value = computeDesignOffset(data.offsetX);
        mat.uniforms.offsetY.value = computeDesignOffset(data.offsetY);
        mat.uniforms.designScale.value = computeDesignScale(data.scale);
        renderer.render(scene, camera);
    };

    window.requestAnimationFrame(render);
}
