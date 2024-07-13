with import <nixpkgs> { system = "x86_64-linux"; };

let
    tasksCurl = pkgs.curl.override { 
        c-aresSupport = true; 
        gsaslSupport = true; 
    };

    toBool = str: str == "1";
    tarEnabled = toBool (builtins.getEnv "TAR");

    tasksGnutar = if tarEnabled then [ pkgs.gnutar ] else [];
in
    pkgs.buildEnv {
        name = "tasks-nix-env";
        paths = with pkgs; [
            tasksCurl
        ] ++ tasksGnutar;
    }