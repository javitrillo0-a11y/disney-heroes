class SpineCharacter {
    constructor(canvas, assetsPath) {
        this.canvas = canvas;
        this.assetsPath = assetsPath;
        this.skeleton = null;
        this.animationState = null;
        this.loaded = false;
        this.x = 0;
        this.y = 0;
        this.scale = 1;
        this.flipX = false;
        
        this.gl = null;
        this.shader = null;
        this.batcher = null;
    }

    async load() {
        return new Promise((resolve, reject) => {
            const assetManager = new spine.webgl.AssetManager(this.assetsPath);
            
            assetManager.loadText('unit-DEFAULT-untrimmed-smallcombat.atlas');
            assetManager.loadText('unit-DEFAULT-untrimmed-smallcombat.json');
            assetManager.loadTexture('unit-DEFAULT-untrimmed-smallcombat.png');

            assetManager.loadComplete(() => {
                try {
                    const textureAtlas = assetManager.get('unit-DEFAULT-untrimmed-smallcombat.atlas');
                    const atlasLoader = new spine.AtlasAttachmentLoader(textureAtlas);
                    const skeletonJson = new spine.SkeletonJson(atlasLoader);
                    skeletonJson.scale = 1;
                    
                    const skeletonData = skeletonJson.readSkeletonData(
                        assetManager.get('unit-DEFAULT-untrimmed-smallcombat.json')
                    );
                    
                    this.skeleton = new spine.Skeleton(skeletonData);
                    
                    const animationStateData = new spine.AnimationStateData(skeletonData);
                    animationStateData.defaultMix = 0.2;
                    
                    this.animationState = new spine.AnimationState(animationStateData);
                    
                    this.skeleton.setToSetupPose();
                    this.skeleton.updateWorldTransform();
                    
                    this.loaded = true;
                    resolve();
                } catch (error) {
                    reject(error);
                }
            });

            assetManager.update();
        });
    }

    setAnimation(animationName, loop = true) {
        if (this.animationState && this.skeleton) {
            this.animationState.setAnimation(0, animationName, loop);
        }
    }

    addAnimation(animationName, loop = false, delay = 0) {
        if (this.animationState) {
            this.animationState.addAnimation(0, animationName, loop, delay);
        }
    }

    update(deltaTime) {
        if (this.animationState && this.skeleton) {
            this.animationState.update(deltaTime);
            this.animationState.apply(this.skeleton);
            this.skeleton.updateWorldTransform();
        }
    }

    draw(renderer) {
        if (!this.skeleton || !this.loaded) return;

        renderer.begin();
        
        this.skeleton.x = this.x;
        this.skeleton.y = this.y;
        this.skeleton.scaleX = this.flipX ? -this.scale : this.scale;
        this.skeleton.scaleY = this.scale;

        const skeletonRenderer = new spine.webgl.SkeletonRenderer(renderer.gl);
        skeletonRenderer.draw(this.skeleton);
        
        renderer.end();
    }

    getBounds() {
        if (!this.skeleton) return { x: 0, y: 0, width: 0, height: 0 };
        
        const bounds = { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } };
        this.skeleton.getBounds(bounds, []);
        
        return {
            x: this.x + bounds.min.x * this.scale,
            y: this.y + bounds.min.y * this.scale,
            width: (bounds.max.x - bounds.min.x) * this.scale,
            height: (bounds.max.y - bounds.min.y) * this.scale
        };
    }
}