with import <nixpkgs> { system = "x86_64-linux"; };

let
    tasksCurl = pkgs.curl.override { 
        c-aresSupport = true; 
        gsaslSupport = true; 
    };
in
    pkgs.buildEnv {
        name = "tasks-nix-env";
        paths = with pkgs; [
            tasksCurl
        ];
    }