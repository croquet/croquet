// PRE-RELEASE VERSIONS SHOULD ONLY BE USED FOR INTERNAL DEVELOPMENT
if (!location.hostname || Croquet.App.isCroquetHost(location.hostname)) {
    console.warn('This pre-release of Croquet is for internal use only!');
} else {
    console.error('This pre-release of Croquet is for internal use only!');
    console.log('Please use <script src="https://cdn.jsdelivr.net/npm/@croquet/croquet@1.0.5"></script>');
}
